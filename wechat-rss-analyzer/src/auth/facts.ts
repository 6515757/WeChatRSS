// 两个人的事实库，用于 LLM 生成答题
// 每条包含：事实描述（给 LLM 用）、正确答案（用于验证）

export interface Fact {
  question_hint: string; // 给 LLM 的提示，描述这个事实可以出什么题
  answer: string;        // 标准答案
}

export const FACTS: Fact[] = [
  {
    question_hint: '我们相识的日期是哪一天（月日）',
    answer: '1月8号',
  },
  {
    question_hint: '飞之前在哪家公司工作（通过那里的同事介绍认识的）',
    answer: '花旗',
  },
  {
    question_hint: '我们是通过什么方式认识的',
    answer: '通过以前花旗的同事介绍',
  },
  {
    question_hint: '飞的生日是几月几号',
    answer: '9月11号',
  },
  {
    question_hint: '飞是哪一年出生的',
    answer: '1996年',
  },
  {
    question_hint: '我们确定关系的日期是哪一天',
    answer: '2月8号',
  },
  {
    question_hint: '我们第一次一起吃饭是在什么类型的餐厅',
    answer: '火锅店',
  },
  {
    question_hint: '确认关系那天我们一起去做了什么',
    answer: '挂坠饰品',
  },
  {
    question_hint: '3月8号那天我们一起去做了什么',
    answer: '戒指',
  },
  {
    question_hint: '我们第一次一起看樱花是哪一天',
    answer: '3月29日',
  },
  {
    question_hint: '我们第一次在家里吃火锅是哪一天',
    answer: '4月4日',
  },
];

// 给 LLM 的系统 prompt
export const QUIZ_SYSTEM = `你是一个浪漫的出题助手。你需要根据提供的"两个人的故事事实"，生成 5 道四选一的选择题。

要求：
- 题目语气温柔、浪漫、带一点俏皮，像是恋人之间的小测验
- 每道题有 4 个选项（A/B/C/D），只有 1 个正确
- 干扰项要合理但不能太离谱（比如日期类的干扰项用相近的日期）
- 题目不要太死板，可以用"还记得吗"、"猜猜看"之类的口吻
- 5 道题覆盖不同的事实，不要重复同一个事实

严格返回以下 JSON 结构：
{
  "questions": [
    {
      "id": 1,
      "text": "题目文字",
      "options": ["A选项", "B选项", "C选项", "D选项"],
      "correctIndex": 0
    }
  ]
}

correctIndex 是正确答案在 options 数组中的下标（0-3）。
所有字符串中请使用中文引号""''，不要使用英文双引号。
只返回 JSON，不要有其它内容。`;

export function buildQuizPrompt(selectedFacts: Fact[]): string {
  const factsText = selectedFacts
    .map((f, i) => `${i + 1}. ${f.question_hint}（答案：${f.answer}）`)
    .join('\n');

  return `请根据以下 5 个关于"我们"的故事事实，生成 5 道浪漫的四选一选择题：

${factsText}

注意：
- 每道题对应一个事实
- 正确选项必须包含上面给出的答案
- 干扰选项要合理（日期用相近日期，地点用类似地点等）
- 语气要甜蜜温柔`;
}
