/** Story dimension metadata retained independently of its runtime and wizard. */

/** Original workshop generation modes; these do not select a DSH execution provider. */
export type SettingsDimensionKind = 'enum_single' | 'enum_multi' | 'llm_free' | 'edit_external'

/** Historical wizard requirements, preserved as metadata rather than automatic selection. */
export type SettingsRequiredFor = 'novel_writing' | 'script_writing'

/** A named settings input and its direct prerequisites. */
export interface SettingsDimension {
  /** Canonical lowercase dimension code, such as g2. */
  readonly code: string
  /** Original Story dimension name. */
  readonly name: string
  /** Codes that must be available before generating this dimension. */
  readonly dependsOn: readonly string[]
  /** Whether the dimension may participate in a new plan. */
  readonly enabled: boolean
  /** Original generation mode; external editors cannot participate in generation plans. */
  readonly kind: SettingsDimensionKind
  /** Original wizard markers; the planner never adds these dimensions implicitly. */
  readonly requiredFor: readonly SettingsRequiredFor[]
}

/**
 * The 61 Story dimensions, with lowercase codes used by production V2.
 * Source paths and content fingerprints: docs/research/story-settings-migration-research.md.
 */
export const settingsCatalog: readonly SettingsDimension[] = [
  { code: 'a1', name: '类型 / 题材', dependsOn: [], enabled: true, kind: 'enum_single', requiredFor: ['script_writing', 'novel_writing'] },
  { code: 'a2', name: '流派 / 子类型', dependsOn: ['a1'], enabled: true, kind: 'enum_multi', requiredFor: ['script_writing', 'novel_writing'] },
  { code: 'a3', name: '受众', dependsOn: ['a1'], enabled: true, kind: 'enum_single', requiredFor: ['script_writing', 'novel_writing'] },
  { code: 'a4', name: '风格基调', dependsOn: ['a1', 'a3'], enabled: true, kind: 'enum_multi', requiredFor: ['script_writing', 'novel_writing'] },
  { code: 'a5', name: '时空设定', dependsOn: ['a1'], enabled: true, kind: 'enum_single', requiredFor: ['script_writing', 'novel_writing'] },
  { code: 'b1', name: '世界结构 / 多界', dependsOn: ['a1', 'a5'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'b2', name: '地理 / 大陆 / 城市', dependsOn: ['a5', 'b1'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'b3', name: '历史背景 / 编年史', dependsOn: ['a5'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'b4', name: '政治制度 / 王朝 / 阶级', dependsOn: ['a1', 'a5'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'b5', name: '经济 / 货币 / 商业', dependsOn: ['a1', 'a5'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'b6', name: '宗教 / 信仰 / 神话', dependsOn: ['a1', 'a5'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'b7', name: '种族 / 异族 / 妖族', dependsOn: ['a1', 'b1'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'b8', name: '气候 / 自然环境', dependsOn: ['a5', 'b2'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'b9', name: '文化 / 风俗 / 节日', dependsOn: ['a5', 'b6'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'b10', name: '语言 / 文字', dependsOn: ['a1', 'a5'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'b11', name: '科技 / 工业水平', dependsOn: ['a5'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'b12', name: '法律 / 律例 / 戒律', dependsOn: ['b4'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'c1', name: '修炼等级体系', dependsOn: ['a1', 'a2'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'c2', name: '灵气 / 能量源', dependsOn: ['a1', 'c1'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'c3', name: '特殊体质 / 血脉 / 灵根', dependsOn: ['a1', 'c1'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'c4', name: '功法 / 秘法 / 心法', dependsOn: ['c1'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'c5', name: '招式 / 技能 / 神技', dependsOn: ['c2', 'c4'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'c6', name: '法宝 / 神器 / 宝物', dependsOn: ['c1'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'c7', name: '丹药 / 灵药 / 仙药', dependsOn: ['c2'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'c8', name: '阵法 / 符箓 / 禁制', dependsOn: ['c1', 'c2'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'd1', name: '势力 / 组织', dependsOn: ['a1', 'b1'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'e1', name: '主角设定', dependsOn: ['a1', 'a2'], enabled: true, kind: 'llm_free', requiredFor: ['script_writing', 'novel_writing'] },
  { code: 'e2', name: '男主 / 女主 / 双主角', dependsOn: ['e1'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'e3', name: '反派（按段位）', dependsOn: ['e1'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'e4', name: '阶段性反派 / 一生之敌', dependsOn: ['e1', 'e3'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'e5', name: '助攻角色', dependsOn: ['e1'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'e6', name: '配角群', dependsOn: ['e1', 'e5'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'e7', name: '妖兽 / 灵宠 / 神兽', dependsOn: ['a1', 'b7'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'e8', name: '关系网（人物图）', dependsOn: ['e1'], enabled: true, kind: 'edit_external', requiredFor: [] },
  { code: 'e9', name: '对话风格', dependsOn: ['e1', 'e2', 'e3'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'e10', name: '内心独白 / 潜台词风格', dependsOn: ['e1', 'e2'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'f1', name: '人名', dependsOn: ['a1', 'a5'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'f2', name: '武器名', dependsOn: ['a1', 'c6'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'f3', name: '招式名', dependsOn: ['a1', 'c5'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'f4', name: '法宝名', dependsOn: ['a1', 'c6'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'f5', name: '门派名 / 组织名', dependsOn: ['a1', 'd1'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'f6', name: '地名 / 国家名', dependsOn: ['a1', 'a5', 'b2'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'g1', name: '金手指', dependsOn: ['a1', 'a2'], enabled: true, kind: 'llm_free', requiredFor: ['script_writing', 'novel_writing'] },
  { code: 'g2', name: '主线', dependsOn: ['a1', 'g1', 'e1'], enabled: true, kind: 'llm_free', requiredFor: ['script_writing', 'novel_writing'] },
  { code: 'g3', name: '阶段目标 / 升级线', dependsOn: ['g2'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'g4', name: '爽点设计', dependsOn: ['a3', 'g2'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'g5', name: '虐点 / 误会 / 反差', dependsOn: ['a4', 'e2'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'g6', name: '反转 / 转折点', dependsOn: ['g2'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'g7', name: '伏笔 / 钩子', dependsOn: ['g2'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'g8', name: '桥段套路库', dependsOn: ['a1', 'a2'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'h1', name: '开场钩子（前30秒强冲突）', dependsOn: ['a1', 'a4'], enabled: true, kind: 'enum_multi', requiredFor: [] },
  { code: 'h2', name: '节拍卡点', dependsOn: ['h1'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'h3', name: '集末钩子', dependsOn: ['a4'], enabled: true, kind: 'enum_multi', requiredFor: [] },
  { code: 'h4', name: '单集节奏曲线', dependsOn: ['a4'], enabled: true, kind: 'enum_single', requiredFor: ['script_writing'] },
  { code: 'h5', name: '男频 / 女频套路', dependsOn: ['a3'], enabled: true, kind: 'enum_single', requiredFor: ['script_writing'] },
  { code: 'h6', name: '道具 / 符号转折', dependsOn: ['e1', 'g2'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'i1', name: '场景描写', dependsOn: ['a4'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'i2', name: '战斗描写', dependsOn: ['c5', 'e3'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'i3', name: '情感描写', dependsOn: ['a4', 'e1'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'i4', name: '对白生成 / 润色', dependsOn: ['a4', 'e9'], enabled: true, kind: 'llm_free', requiredFor: [] },
  { code: 'i5', name: '心理活动 / 旁白', dependsOn: ['e10'], enabled: true, kind: 'llm_free', requiredFor: [] },
]
