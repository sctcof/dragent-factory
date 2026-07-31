# Data-RAG-Agent: 商业数据智能诊断分析完整解决方案

## 一、 系统架构总览

本系统旨在将传统的静态商业智能（BI）转化为基于自然语言的“探索-执行-验证-总结”闭环。通过结合 RAG（检索增强生成）、知识图谱（Knowledge Graph）与 Multi-Agent（多智能体）架构，实现高度白盒化、可溯源的商业数据动态分析与报告自动生成。

为了保证复杂分析任务的成本效益与执行效果，架构中引入了**大模型统一网关与动态选择机制**，允许针对不同智能体的任务特性按需路由或人工指定底层大模型。

核心系统架构采用 **LangGraph** 作为状态机编排引擎，**RAGFlow** 作为知识解析与检索引擎。

```mermaid
graph TD
    subgraph 会话与可视化交互层
        UI[Web UI / 对话界面输入]
        Upload[输入数据源URL / 上传文件与报告]
        Chart[图表与知识图谱可视化]
        Editor[代码沙箱与策略确认器]
        Cart[报告购物车]
        ModelSelector[大模型切换与配置面板]
    end

    subgraph LLM 统一网关与路由层 (如 OpenRouter/OneAPI)
        Router{Model Router}
        ModelA[高阶推理模型]
        ModelB[代码生成专精模型]
        ModelC[极速轻量模型]
    end

    subgraph 数据理解与图谱构建层
        Plugin[数据库直连插件]
        DataAgent[数据理解智能体]
        Extract[多模态解析管线]
        KG[知识图谱构建与网页导出]
    end

    subgraph 报告合成层
        Merge[多轮上下文合并]
        GenReport[报告生成 Agent]
        Export[Markdown/PDF/HTML 导出]
    end

    subgraph 多智能体调度与执行层 (LangGraph)
        Planner[Planner Agent: 意图识别与策略生成]
        Confirm{用户确认分析策略?}
        Coder[Coder Agent: Python/SQL 代码生成]
        Executor[Executor Sandbox: 代码执行与溯源]
        Analyzer[Analyzer Agent: 结果解读与图表配置]
        
        Planner --> Confirm
        Confirm -- 确认/修改 --> Coder
        Coder --> Executor
        Executor -- 报错或需人工干预 --> Editor
        Editor --> Executor
        Executor -- 执行成功 --> Analyzer
    end

    subgraph RAG 知识中枢 (RAGFlow)
        Dict[库 A: 数据字典与图谱拓扑]
        Strategy[库 B: 分析策略与模板]
        Domain[库 C: 行业与业务知识]
    end

    UI --> Upload
    UI --> ModelSelector
    ModelSelector --> Router
    
    DataAgent & Planner & Coder & Analyzer & GenReport -.调用.-> Router
    
    Upload -- URL --> Plugin
    Upload -- 文件 --> Extract
    Plugin & Extract --> DataAgent
    DataAgent --> KG
    KG --> Dict
    KG --> Chart
    
    UI <--> Planner
    Analyzer --> UI
    Analyzer --> Chart
    UI --> Cart
    Cart --> Merge
    Merge --> GenReport
    GenReport --> Export
```

## 二、 详细模块设计与实现方案

### 2.1 大模型网关与动态选择机制 (按需分配算力)
为了兼顾生成质量与响应速度，系统通过统一的 API 接口标准接入多个模型供应商，并在每个智能体节点实现模型的可选配置。

1. **统一路由层**：构建类似标准 OpenAI API 格式的网关层，集中管理各模型 API Key 与并发限制。
2. **场景化默认推荐与自定义**：
   - **DataAgent & Planner (数据理解与策略规划)**：推荐选用具备强逻辑推理与长上下文能力的高阶模型。
   - **Coder Agent (代码生成)**：推荐选用代码训练语料丰富、指令遵循度高的专精模型。
   - **Analyzer & Report Generator (报告与图表配置)**：可选用响应速度快、文本润色能力强的模型。
3. **前端配置与运行时注入**：对话框顶部提供全局模型选择器，同时在高级设置中支持为每个独立 Agent 指定不同的基础模型。LangGraph 每次触发节点流转时，根据当前配置将不同的 LLM 实例注入到执行链中。

### 2.2 对话式数据接入与知识图谱构建 (数据底座)
用户可直接在对话框中粘贴数据库 URL 或上传文件（CSV、PDF、PPT 等），系统将自动触发深度理解管线。

1. **针对数据源链接 (数据库接入)**
   - **自动化直连**：调用预置插件自动连接数据库。
   - **数据理解智能体**：获取表 Schema，并调用数据获取工具进行抽样，追踪字段级（Column-level）的指标血缘关系。
   - **图谱构建**：将表、字段、指标作为实体节点，外键与血缘作为边，构建“数据关系知识图谱”。
2. **针对上传的数据文件与分析报告**
   - **多模态解析**：通过视觉模型对复杂的学术幻灯片或 PDF 报告进行版面分析与结构化信息抽取。
   - **图谱抽取原则 (断言独立性)**：在构建知识图谱实体时，严格确保断言的独立性——`new_generate` 的事实结论除非明确绑定了底层的具体数据引用 (Supporting IDs)，否则不得进行主观的逻辑关联，从而避免图谱关系的污染与幻觉。
3. **可视化展示、存储与导出**
   - **图谱交互**：通过前端组件直接在对话流中渲染数据网状关系。
   - **RAG 存储与网页导出**：图谱节点和数据字典存入 RAGFlow，同时提供打包导出单页 HTML 文件的功能，实现离线保存。

### 2.3 RAG 知识中枢设计
*   **库 A：数据字典与资产**：存储表结构、数据分布特征及图谱拓扑描述。
*   **库 B：分析策略域**：以 JSON 格式存储标准分析策略模板。
*   **库 C：业务与行业知识域**：存储专有名词解释与指标计算逻辑。

### 2.4 策略前置与多智能体分析引擎
在执行真正的数据分析前，**必须先输出分析策略并获取用户确认**。

1. **Planner Agent (策略规划)**
   - 结合用户意图与 RAG 检索，输出结构化的《分析策略书》（维度、指标、方法、推荐图表）。
2. **用户确认机制 (Human-in-the-loop)**
   - 前端呈现《分析策略书》，用户可直接修改（如更改聚合维度），经 Planner 调整后生效。
3. **Coder Agent (代码生成)**
   - 严格遵循已确认的策略与选定的代码模型，生成 Python 或 SQL。
4. **Executor Sandbox (执行与白盒溯源机制)**
   - 在沙箱中执行，记录完整数据链路。支持报错回传与前端在线代码编辑重跑。
5. **Analyzer Agent (结果解读)**
   - 基于执行数据框，生成自然语言结论及图表渲染 JSON。

### 2.5 可视化交互与报告合成
1. **图表渲染**：前端解析特定的 `<chart_config>` 标签，动态渲染 ECharts 图表。
2. **报告购物车**：多轮对话中，用户勾选高价值的策略、代码、图表与结论。
3. **报告生成与导出**：统一汇总购物车内容，由专门的生成 Agent 排版输出，支持 Markdown、PDF 等结构化导出。
