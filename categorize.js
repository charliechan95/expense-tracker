/* Expense Tracker — auto-categorization engine (v2).
   Deterministic pipeline, no AI, no network:
     1. user rules (pattern -> category, first match wins)
     2. merchant memory (learned from the user's own corrections)
     3. keyword defaults (HK-sensible starter set, bilingual)
     4. null -> goes to the "Needs review" inbox, never silently "Other"
   Pure logic: DB.getUserRules() / DB.getMerchantMemory() are the only
   dependencies, so this file is unit-testable in node with a stub. */
"use strict";

/* Line-icon set (24x24, stroke=currentColor). Rendered into .cat-ico spans;
   keep each icon one <svg> so innerHTML injection just works. */
const _sw = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
const _svg = (inner) => `<svg ${_sw}>${inner}</svg>`;

const CATEGORIES = {
  "Food & Drink":  { zh: "餐饮", color: "#c05621", icon: _svg('<path d="M7 9.5h10l-1.1 8.3a1.6 1.6 0 0 1-1.6 1.4H9.7a1.6 1.6 0 0 1-1.6-1.4L7 9.5z"/><path d="M17 10.5h1.3a2.4 2.4 0 0 1 0 4.8H16.7"/><path d="M10 6.2c0-1.1.9-1.2.9-2.3M13.6 6.2c0-1.1.9-1.2.9-2.3"/>') },
  "Groceries":     { zh: "超市", color: "#5b8c3e", icon: _svg('<path d="M4.5 11h15l-1.5 7.6a2 2 0 0 1-2 1.6H8a2 2 0 0 1-2-1.6L4.5 11z"/><path d="M8.5 11V8.2a3.5 3.5 0 0 1 7 0V11"/>') },
  "Transport":     { zh: "交通", color: "#3e6b8c", icon: _svg('<rect x="5" y="4.5" width="14" height="10.5" rx="2"/><path d="M5 10h14"/><circle cx="8.6" cy="17.8" r="1.5"/><circle cx="15.4" cy="17.8" r="1.5"/>') },
  "Shopping":      { zh: "购物", color: "#8c5b7a", icon: _svg('<path d="M6.2 8h11.6l-.9 11.2a1.6 1.6 0 0 1-1.6 1.5H8.7a1.6 1.6 0 0 1-1.6-1.5L6.2 8z"/><path d="M9.2 10.5V6.4a2.8 2.8 0 0 1 5.6 0v4.1"/>') },
  "Housing":       { zh: "住房", color: "#a67c3d", icon: _svg('<path d="M4.5 11L12 4.5 19.5 11"/><path d="M6.5 9.8V19.5h11V9.8"/><path d="M10.2 19.5v-4.8h3.6v4.8"/>') },
  "Utilities":     { zh: "杂费", color: "#6b7280", icon: _svg('<path d="M9.5 18h5"/><path d="M10.5 20.8h3"/><path d="M12 3.5a5.8 5.8 0 0 0-3.5 10.4c.7.6 1.1 1.3 1.3 2.1h4.4c.2-.8.6-1.5 1.3-2.1A5.8 5.8 0 0 0 12 3.5z"/>') },
  "Health":        { zh: "健康", color: "#3e8c6b", icon: _svg('<path d="M12 20s-6.8-4.2-6.8-9.7A3.9 3.9 0 0 1 12 7.6a3.9 3.9 0 0 1 6.8 2.7c0 5.5-6.8 9.7-6.8 9.7z"/><path d="M7.5 12h2.6l1.4-2.8 1.9 4.8 1.4-2h2"/>') },
  "Entertainment": { zh: "娱乐", color: "#b23a48", icon: _svg('<rect x="4" y="5.5" width="16" height="13" rx="2"/><path d="M8 5.5v13M16 5.5v13M4 10h4M4 14h4M16 10h4M16 14h4"/>') },
  "Travel":        { zh: "旅行", color: "#4a7fb5", icon: _svg('<path d="M20.5 3.5L3.5 10.6l6.8 2.4 2.4 6.8 7.8-16.3z"/><path d="M20.5 3.5L10.3 13"/>') },
  "Education":     { zh: "教育", color: "#8c6b3e", icon: _svg('<path d="M12 6.2C10 4.7 7 4.2 4 4.2v13.6c3 0 6 .5 8 2 2-1.5 5-2 8-2V4.2c-3 0-6 .5-8 2z"/><path d="M12 6.2v13.6"/>') },
  "Personal":      { zh: "个人", color: "#7a5fa8", icon: _svg('<circle cx="12" cy="8" r="3.4"/><path d="M5.2 19.8a6.8 6.8 0 0 1 13.6 0"/>') },
  "Other":         { zh: "其他", color: "#9a958a", icon: _svg('<path d="M4.5 8L12 4.2 19.5 8v7.8L12 19.8 4.5 15.8V8z"/><path d="M4.5 8L12 12l7.5-4M12 12v7.5"/>') },
};
const CATEGORY_IDS = Object.keys(CATEGORIES);

function catMeta(category) {
  return CATEGORIES[category] || CATEGORIES["Other"];
}
/* "Food & Drink 餐饮" — text only, safe for <option> elements.
   The SVG icon lives in m.icon and is rendered into .cat-ico spans. */
function catLabel(category) {
  const m = catMeta(category);
  const en = category || "Other";
  return `${en} ${m.zh}`;
}

function normMerchant(s) {
  return String(s == null ? "" : s).toLowerCase().replace(/\s+/g, " ").trim();
}

/* Ordered by priority: earlier categories win on keyword overlap. */
const CATEGORY_KEYWORDS = [
  ["Food & Drink", [
    "星巴克", "starbucks", "麦当劳", "mcdonald", "肯德基", "kfc", "大家乐",
    "大快活", "茶餐厅", "茶楼", "酒楼", "火锅", "hotpot", "点心", "dimsum",
    "餐厅", "restaurant", "cafe", "café", "coffee", "咖啡", "奶茶", "喜茶",
    "奈雪", "pizza", "寿司", "sushi", "burger", "面包", "bakery",
    "foodpanda", "deliveroo", "keeta", "food", "dine", "dining",
    "早餐", "午餐", "晚餐", "lunch", "dinner", "breakfast", "小食", "snack",
    "甜品", "dessert", "糖水",
  ]],
  ["Groceries", [
    "7-eleven", "7eleven", "711", "ok便利店", "circle k", "circlek",
    "惠康", "wellcome", "百佳", "parknshop", "超市", "supermarket",
    "citysuper", "market place", "一田", "donki", "759", "阿信屋",
    "街市", "菜市场",
  ]],
  ["Transport", [
    "港铁", "mtr", "九巴", "kmb", "城巴", "citybus", "巴士", "bus",
    "的士", "taxi", "uber", "didi", "滴滴", "打车", "高铁", "机场快线",
    "airport express", "渡轮", "ferry", "天星小轮", "停车", "parking",
    "加油", "petrol", "shell", "esso", "caltex", "中石化", "八达通",
    "octopus",
  ]],
  ["Shopping", [
    "淘宝", "taobao", "京东", "jd.com", "拼多多", "pinduoduo", "amazon",
    "uniqlo", "优衣库", "无印良品", "muji", "屈臣氏", "watsons", "万宁",
    "mannings", "sasa", "莎莎", "卓悦", "bonjour", "nike", "adidas",
    "apple", "丰泽", "fortress", "百老汇电器", "sogo", "崇光",
    "海港城", "harbour city", "shopping", "购物",
  ]],
  ["Housing", [
    "房租", "rent", "管理费", "management fee", "物业", "供楼",
    "mortgage", "差餉", "rates", "租金",
  ]],
  ["Utilities", [
    "电费", "electricity", "水费", "水务", "煤气", "gas", "中华煤气",
    "towngas", "电话费", "手机费", "mobile", "宽带", "broadband",
    "上网", "internet", "netvigator", "csl", "3hk", "3香港", "smarTone",
    "数码通", "中国移动", "china mobile", "中国联通", "unicom",
    "now tv", "nowtv",
  ]],
  ["Health", [
    "医院", "hospital", "诊所", "clinic", "药房", "pharmacy", "药",
    "牙科", "dental", "体检", "checkup", "中医", "tcm", "眼科",
    "物理治疗", "physio",
  ]],
  ["Entertainment", [
    "电影", "cinema", "戏院", "电影院", "mcl", "演唱会", "concert",
    "ktv", "酒吧", "bar", "游戏", "game", "steam", "nintendo",
    "playstation", "netflix", "spotify", "disney", "youtube premium",
    "按摩", "massage", "spa", "健身", "gym", "pure fitness", "瑜伽",
    "yoga", "卡拉ok", "karaoke",
  ]],
  ["Travel", [
    "酒店", "hotel", "机票", "flight", "航班", "航空", "airline",
    "国泰", "cathay pacific", "trip.com", "tripcom", "携程", "ctrip",
    "agoda", "booking.com", "airbnb", "expedia", "旅行", "travel",
    "签证", "visa application", "港珠澳", "hzm",
  ]],
  ["Education", [
    "学校", "school", "课程", "course", "udemy", "coursera", "书店",
    "bookstore", "商务印书馆", "commercial press", "补习", "tutorial",
    "学费", "tuition",
  ]],
  ["Personal", [
    "理发", "haircut", "salon", "发廊", "美容", "beauty", "美甲",
    "nail", "洗衣", "laundry", "干洗",
  ]],
];

const Categorizer = {
  /* Returns { category: string|null, via: "rule"|"memory"|"keyword"|"none" }.
     Merchant name is matched before the description — the merchant is the
     stronger signal ("7-Eleven" + "早餐" is Groceries, not Food & Drink). */
  propose(merchant, description) {
    const merch = normMerchant(merchant || "");
    const hay = normMerchant(merch + " " + (description || ""));
    if (!hay) return { category: null, via: "none" };
    for (const r of DB.getUserRules()) {
      if (r.pattern && hay.includes(normMerchant(r.pattern))) {
        return { category: r.category, via: "rule" };
      }
    }
    const mem = DB.getMerchantMemory();
    const remembered = mem[merch];
    if (remembered && CATEGORIES[remembered]) {
      return { category: remembered, via: "memory" };
    }
    const byKeyword = (text) => {
      for (const [cat, kws] of CATEGORY_KEYWORDS) {
        for (const k of kws) {
          if (text.includes(k)) return cat;
        }
      }
      return null;
    };
    const m1 = merch && byKeyword(merch);
    if (m1) return { category: m1, via: "keyword" };
    const m2 = byKeyword(hay);
    if (m2) return { category: m2, via: "keyword" };
    return { category: null, via: "none" };
  },

  learn(merchant, category) {
    DB.learnMerchant(merchant, category);
  },
};

/* node test harness: `node categorize.js --test` with a DB stub */
if (typeof module !== "undefined" && require.main === module) {
  const assert = require("assert");
  global.DB = {
    getUserRules: () => [{ pattern: "Netflix", category: "Entertainment" }],
    getMerchantMemory: () => ({ "7-eleven": "Groceries" }),
  };
  const cases = [
    ["Starbucks", "Coffee", "Food & Drink", "keyword"],
    ["7-Eleven", "Snacks", "Groceries", "memory"],
    ["NETFLIX", "", "Entertainment", "rule"],
    ["港铁", "车费", "Transport", "keyword"],
    ["大家乐", "", "Food & Drink", "keyword"],
    ["惠康", " groceries", "Groceries", "keyword"],
    ["7-Eleven", "早餐", "Groceries", "memory"], // memory outranks keyword
    ["XYZ Unknown", "打车去机场", "Transport", "keyword"], // description fallback
    ["XYZ Unknown Merchant 123", "", null, "none"],
    ["", "", null, "none"],
  ];
  for (const [m, d, want, via] of cases) {
    const r = Categorizer.propose(m, d);
    assert.strictEqual(r.category, want, `${m} -> ${r.category} (want ${want})`);
    assert.strictEqual(r.via, via, `${m} via ${r.via} (want ${via})`);
  }
  console.log("categorize.js: all", cases.length, "tests passed");
}
