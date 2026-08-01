from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

from packages.shared_types.models import Asset

logger = logging.getLogger(__name__)


class Neo4jGraphStore:
    """Neo4j-backed knowledge graph with graceful fallback when unavailable."""

    def __init__(self, uri: str, user: str, password: str) -> None:
        self.uri = uri
        self.user = user
        self.password = password
        self._driver = None
        self._disabled = False

    def _connect(self):
        if self._disabled:
            return None
        if self._driver is not None:
            return self._driver
        try:
            from neo4j import GraphDatabase

            driver = GraphDatabase.driver(self.uri, auth=(self.user, self.password))
            driver.verify_connectivity()
            self._driver = driver
            return self._driver
        except Exception as exc:  # noqa: BLE001
            logger.warning("Neo4j unavailable, graph store disabled: %s", exc)
            self._disabled = True
            return None

    def close(self) -> None:
        if self._driver is not None:
            self._driver.close()
            self._driver = None

    def ping(self) -> bool:
        driver = self._connect()
        if not driver:
            return False
        try:
            driver.verify_connectivity()
            return True
        except Exception:  # noqa: BLE001
            return False

    def upsert_asset_graph(self, asset: Asset) -> bool:
        driver = self._connect()
        if not driver or not asset.graph:
            return False
        nodes = asset.graph.nodes
        edges = asset.graph.edges
        try:
            with driver.session() as session:
                session.execute_write(self._write_graph, asset.id, asset.name, nodes, edges)
            return True
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to write asset graph to Neo4j: %s", exc)
            return False

    @staticmethod
    def _write_graph(tx, asset_id: str, asset_name: str, nodes: List[Dict[str, Any]], edges: List[Dict[str, Any]]) -> None:
        tx.run(
            """
            MERGE (a:Asset {id: $asset_id})
            SET a.name = $asset_name, a.updated_at = datetime()
            """,
            asset_id=asset_id,
            asset_name=asset_name,
        )
        for node in nodes:
            node_id = str(node.get("id") or "")
            if not node_id:
                continue
            label = str(node.get("type") or "Node").replace(" ", "_")
            props = {
                "id": node_id,
                "label": str(node.get("label") or node_id),
                "type": str(node.get("type") or "Node"),
                "asset_id": asset_id,
                "logical_type": str(node.get("logical_type") or ""),
            }
            tx.run(
                f"""
                MERGE (n:{label} {{id: $id}})
                SET n.label = $label, n.type = $type, n.asset_id = $asset_id, n.logical_type = $logical_type
                WITH n
                MATCH (a:Asset {{id: $asset_id}})
                MERGE (a)-[:HAS_NODE]->(n)
                """,
                **props,
            )
        for edge in edges:
            source = str(edge.get("source") or "")
            target = str(edge.get("target") or "")
            rel = str(edge.get("type") or "RELATES").replace(" ", "_").replace(":", "_")
            if not source or not target:
                continue
            tx.run(
                f"""
                MATCH (s {{id: $source}})
                MATCH (t {{id: $target}})
                MERGE (s)-[r:{rel}]->(t)
                SET r.asset_id = $asset_id
                """,
                source=source,
                target=target,
                asset_id=asset_id,
            )

    def load_asset_graph(self, asset_id: str) -> Optional[Dict[str, Any]]:
        driver = self._connect()
        if not driver:
            return None
        try:
            with driver.session() as session:
                result = session.run(
                    """
                    MATCH (a:Asset {id: $asset_id})-[:HAS_NODE]->(n)
                    OPTIONAL MATCH (n)-[r]->(m)
                    WHERE m.asset_id = $asset_id OR exists((a)-[:HAS_NODE]->(m))
                    RETURN collect(DISTINCT {
                      id: n.id, label: n.label, type: n.type, logical_type: n.logical_type
                    }) AS nodes,
                    collect(DISTINCT {
                      source: startNode(r).id, target: endNode(r).id, type: type(r)
                    }) AS edges
                    """,
                    asset_id=asset_id,
                ).single()
            if not result:
                return None
            nodes = [node for node in result["nodes"] if node and node.get("id")]
            edges = [
                edge
                for edge in result["edges"]
                if edge and edge.get("source") and edge.get("target")
            ]
            return {"nodes": nodes, "edges": edges}
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to load asset graph from Neo4j: %s", exc)
            return None

    def load_combined_graph(self, asset_ids: List[str]) -> Optional[Dict[str, Any]]:
        driver = self._connect()
        if not driver or not asset_ids:
            return None
        try:
            with driver.session() as session:
                result = session.run(
                    """
                    MATCH (a:Asset)-[:HAS_NODE]->(n)
                    WHERE a.id IN $asset_ids
                    OPTIONAL MATCH (n)-[r]->(m)
                    WHERE m.asset_id IN $asset_ids
                    RETURN collect(DISTINCT {
                      id: n.id, label: n.label, type: n.type, logical_type: n.logical_type, asset_id: n.asset_id
                    }) AS nodes,
                    collect(DISTINCT {
                      source: startNode(r).id, target: endNode(r).id, type: type(r)
                    }) AS edges
                    """,
                    asset_ids=asset_ids,
                ).single()
            if not result:
                return None
            nodes = [node for node in result["nodes"] if node and node.get("id")]
            edges = [
                edge
                for edge in result["edges"]
                if edge and edge.get("source") and edge.get("target")
            ]
            root_id = "collection:" + ":".join(sorted(asset_ids))
            nodes.insert(0, {"id": root_id, "type": "Collection", "label": "多数据集整体知识图", "asset_count": len(asset_ids)})
            for asset_id in asset_ids:
                edges.append({"source": root_id, "target": f"dataset:{asset_id}", "type": "INCLUDES"})
            return {"nodes": nodes, "edges": edges}
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to load combined graph from Neo4j: %s", exc)
            return None


_store: Optional[Neo4jGraphStore] = None


def get_graph_store(
    uri: str | None = None,
    user: str | None = None,
    password: str | None = None,
) -> Neo4jGraphStore:
    global _store
    if _store is None:
        _store = Neo4jGraphStore(
            uri or os.getenv("NEO4J_URI", "bolt://localhost:7687"),
            user or os.getenv("NEO4J_USER", "neo4j"),
            password or os.getenv("NEO4J_PASSWORD", "dragent-neo4j"),
        )
    return _store
