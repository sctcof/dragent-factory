import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  GitBranch,
  Layers,
  LineChart,
  Network,
  PlayCircle,
  ShieldCheck,
  ShoppingCart,
  TableProperties
} from "lucide-react";

const features = [
  {
    icon: Bot,
    title: "多轮数据诊断",
    text: "围绕同一业务目标持续追问、拆解、执行和复盘，历史会话可关闭、复制并继续分析。"
  },
  {
    icon: GitBranch,
    title: "策略先行",
    text: "每轮分析先生成可确认策略，支持流程图、策略资产复用、点赞反馈沉淀为个性化策略。"
  },
  {
    icon: LineChart,
    title: "图表即结果",
    text: "执行结果直接返回曲线、柱状、饼图、热力图和明细表，并支持切换图表形态。"
  },
  {
    icon: ShoppingCart,
    title: "报告编排",
    text: "把对话中的策略、结果、图表加入报告，生成独立报告页并支持导出。"
  }
];

const architecture = [
  { name: "Web 工作台", detail: "对话、资产、策略、报告统一交互入口" },
  { name: "FastAPI 应用服务", detail: "会话编排、任务流转与资产索引服务" },
  { name: "Planner / Coder / Analyzer", detail: "拆解目标、生成代码、执行分析并复盘" },
  { name: "RAG 与知识图谱", detail: "补充字段画像、口径、关系和历史经验" },
  { name: "数据连接与字典画像", detail: "文件、数据库、多表数据集自动画像" },
  { name: "沙箱执行与报告看板", detail: "可追溯执行、图表返回和报告沉淀" }
];

const connections = [
  { title: "文件数据", items: ["CSV", "Excel", "多表数据集"], metric: "schema profile" },
  { title: "主流数据库", items: ["MySQL", "PostgreSQL", "SQLite"], metric: "live connector" },
  { title: "知识上下文", items: ["字段画像", "图谱关系", "RAG 检索"], metric: "context engine" }
];

const cases = [
  {
    name: "零售经营复盘",
    focus: "GMV、订单、客单价、区域贡献和商品结构",
    result: "自动输出趋势、贡献、异常和经营动作建议。",
    assets: ["orders", "order_items", "products"],
    signal: ["78%", "42%", "19%"]
  },
  {
    name: "营销投放诊断",
    focus: "campaign、channel、spend、clicks、转化表现",
    result: "识别高效渠道、预算浪费和可下钻人群。",
    assets: ["campaigns", "customers", "channels"],
    signal: ["63%", "86%", "31%"]
  },
  {
    name: "库存与履约风险",
    focus: "inventory、shipments、returns、support tickets",
    result: "定位缺货、积压、退货和服务体验风险。",
    assets: ["inventory", "shipments", "returns"],
    signal: ["55%", "71%", "48%"]
  }
];

const operationFlow = [
  {
    icon: Database,
    title: "接入数据",
    detail: "在对话框选择已有数据资产，或上传 CSV / Excel，也可以在数据资产页创建数据库连接。",
    tag: "asset"
  },
  {
    icon: Network,
    title: "补充上下文",
    detail: "系统读取字段画像、元数据、图谱关系和 RAG 检索结果，形成当前分析上下文。",
    tag: "rag"
  },
  {
    icon: GitBranch,
    title: "生成策略",
    detail: "输入业务目标后，Agent 先拆解分析路径，生成可确认的多步骤策略流程。",
    tag: "plan"
  },
  {
    icon: PlayCircle,
    title: "确认执行",
    detail: "确认策略后进入沙箱执行，生成分析代码、运行结果和可追溯执行记录。",
    tag: "run"
  },
  {
    icon: LineChart,
    title: "查看洞察",
    detail: "每轮回复直接展示曲线、柱状图、饼图、热力图和明细表，并支持切换图表类型。",
    tag: "chart"
  },
  {
    icon: ShoppingCart,
    title: "沉淀报告",
    detail: "把策略、结果和图表加入报告，形成独立报告页，支持继续编排和导出。",
    tag: "report"
  }
];

const heroProductShots = [
  "/hero-analytics-workspace.png",
  "/hero-strategy-workspace.png",
  "/hero-report-workspace.png",
  "/hero-data-knowledge-workspace.png"
];

export default function HomePage() {
  return (
    <main className="homePage">
      <header className="homeNav">
        <a className="homeBrand" href="/">
          <Bot size={22} />
          <span>Data-RAG-Agent</span>
        </a>
        <nav>
          <a href="#workflow">流程</a>
          <a href="#features">功能</a>
          <a href="#architecture">架构</a>
          <a href="#connections">数据连接</a>
          <a href="#cases">案例</a>
          <a className="homeNavCta" href="/workspace">进入工作台</a>
        </nav>
      </header>

      <section className="homeHero">
        <div className="homeHeroScene" aria-hidden="true">
          <div className="homeHeroProductShot">
            {heroProductShots.map((src, index) => (
              <img
                key={src}
                src={src}
                alt=""
                aria-hidden="true"
                style={{ animationDelay: `${index * 6}s` }}
              />
            ))}
          </div>
        </div>
        <div className="homeHeroContent">
          <h1>智能化商业数据分析工厂</h1>
          <p>
            面向商业数据诊断的白盒分析工作台：连接文件与数据库，构建数据资产画像，
            通过 RAG 补充上下文，让 Agent 在多轮对话中生成策略、执行代码、返回图表和报告。
          </p>
          <div className="homeHeroActions">
            <a className="homePrimaryCta" href="/workspace">
              进入工作台 <ArrowRight size={18} />
            </a>
            <a className="homeSecondaryCta" href="/data-assets">
              查看数据资产
            </a>
          </div>
          <div className="homeHeroStats">
            <span><strong>6</strong> 层架构</span>
            <span><strong>14+</strong> 数据资产</span>
            <span><strong>多轮</strong> 策略闭环</span>
          </div>
        </div>
      </section>

      <section id="workflow" className="homeBand homeUsageBand">
        <div className="homeSectionHeader homeUsageHeader">
          <h2>按业务目标驱动的操作分析流程</h2>
          <p>从选择数据到生成报告，用户只需要围绕问题持续对话；系统把数据上下文、策略、执行和图表结果串成可追溯流程。</p>
        </div>
        <div className="homeUsageFlow" aria-label="Data-RAG-Agent 操作分析流程">
          {operationFlow.map((step, index) => {
            const Icon = step.icon;
            return (
              <article key={step.title} className="homeUsageStep">
                <div className="homeUsageStepTop">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <Icon size={22} />
                </div>
                <h3>{step.title}</h3>
                <p>{step.detail}</p>
                <em>{step.tag}</em>
              </article>
            );
          })}
        </div>
      </section>

      <div className="homeModuleSlider" aria-label="首页核心模块自动轮播">
        <div className="homeModuleTrack">
          <section id="features" className="homeBand homeModuleSlide homeFeatureBand">
            <div className="homeSectionHeader">
              <h2>从数据接入到报告生成的一体化闭环</h2>
              <p>以 Agent 为核心，把策略确认、代码执行、图表洞察和报告沉淀串成可追溯工作流。</p>
            </div>
            <div className="homeFeaturePanel">
              <div className="homeFeaturePanelLead">
                <strong>Agentic Analysis Loop</strong>
                <p>用户只提出业务目标，系统自动完成上下文检索、策略生成、沙箱执行、图表返回和报告沉淀。</p>
                <div className="homeFeatureTelemetry" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
              <div className="homeFeatureFlow">
                {features.map((feature, index) => {
                  const Icon = feature.icon;
                  return (
                    <article key={feature.title} className="homeFeatureCard">
                      <span className="homeFeatureIndex">{String(index + 1).padStart(2, "0")}</span>
                      <Icon size={22} />
                      <div>
                        <h3>{feature.title}</h3>
                        <p>{feature.text}</p>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </section>

          <section id="architecture" className="homeBand homeModuleSlide homeArchitectureBand">
            <div className="homeSectionHeader">
              <h2>六层模块化架构，方便替换真实模型与生产组件</h2>
            </div>
            <div className="homeArchitectureFlow">
              {architecture.map((item, index) => (
                <div key={item.name} className="homeArchitectureStep">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{item.name}</strong>
                  <em>{item.detail}</em>
                </div>
              ))}
            </div>
          </section>

          <section id="connections" className="homeBand homeModuleSlide">
            <div className="homeSectionHeader">
              <h2>统一管理文件、数据库和知识上下文</h2>
            </div>
            <div className="homeConnectionGrid">
              {connections.map((connection, index) => {
                const Icon = index === 0 ? FileSpreadsheet : index === 1 ? Database : Network;
                return (
                  <article key={connection.title} className="homeConnectionCard">
                    <div className="homeConnectionTop">
                      <Icon size={24} />
                      <span>{connection.metric}</span>
                    </div>
                    <h3>{connection.title}</h3>
                    <div className="homeConnectionChips">
                      {connection.items.map((item) => <span key={item}>{item}</span>)}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section id="cases" className="homeBand homeModuleSlide homeCaseBand">
            <div className="homeSectionHeader">
              <h2>内置复杂零售样例，覆盖多表联合分析</h2>
              <p>把多源表结构、指标口径、业务问题和分析策略组织成可执行任务，返回可追溯的图表与结论。</p>
            </div>
            <div className="homeCaseGrid">
              {cases.map((item, index) => (
                <article key={item.name} className="homeCaseCard">
                  <div className="homeCaseTopline">
                    <span>CASE 0{index + 1}</span>
                    <CheckCircle2 size={18} />
                  </div>
                  <h3>{item.name}</h3>
                  <div className="homeCaseAssetRow">
                    {item.assets.map((asset) => <span key={asset}>{asset}</span>)}
                  </div>
                  <p>{item.focus}</p>
                  <div className="homeCaseSignal" aria-hidden="true">
                    {item.signal.map((value, signalIndex) => (
                      <i key={`${item.name}-${signalIndex}`} style={{ width: value }} />
                    ))}
                  </div>
                  <strong>{item.result}</strong>
                </article>
              ))}
            </div>
          </section>
        </div>
      </div>

      <section className="homeFinalBand">
        <div>
          <Layers size={24} />
          <h2>把每一次分析都沉淀为可复用资产</h2>
          <p>策略、数据字典、图谱关系、代码执行和报告模块都会成为后续对话的上下文。</p>
        </div>
        <a className="homePrimaryCta" href="/workspace">
          开始分析 <PlayCircle size={18} />
        </a>
      </section>

      <footer className="homeFooter">
        <span>Data-RAG-Agent Factory</span>
        <span><ShieldCheck size={15} /> 本地开发模式可替换真实 LLM Gateway</span>
        <span><TableProperties size={15} /> 支持数据资产、策略资产与报告资产</span>
      </footer>
    </main>
  );
}
