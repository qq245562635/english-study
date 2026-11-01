// 合并两份学习记录（比如手机和电脑各学了一些）。网页和服务器共用这一份代码。
(function (root) {
  "use strict";

  function wordTime(st) {
    if (!st) return -1;
    if (st.last) return st.last;
    // 老数据没有 last：用首次学习日期粗略比较
    return st.seen ? Date.parse(st.seen) : 0;
  }

  function mergeProgress(a, b) {
    a = a || {};
    b = b || {};
    const out = {
      words: {},
      phrases: {},
      days: {},
      settings: {},
      settingsAt: 0,
      updatedAt: Math.max(a.updatedAt || 0, b.updatedAt || 0),
    };

    // 单词：谁最近复习过就用谁的
    const wa = a.words || {}, wb = b.words || {};
    new Set([...Object.keys(wa), ...Object.keys(wb)]).forEach((k) => {
      const x = wa[k], y = wb[k];
      if (!x) out.words[k] = y;
      else if (!y) out.words[k] = x;
      else {
        const tx = wordTime(x), ty = wordTime(y);
        out.words[k] = tx > ty ? x : ty > tx ? y : (x.box >= y.box ? x : y);
      }
    });

    // 句子：两边学会的都算，保留更早的日期
    const pa = a.phrases || {}, pb = b.phrases || {};
    new Set([...Object.keys(pa), ...Object.keys(pb)]).forEach((k) => {
      const x = pa[k], y = pb[k];
      out.phrases[k] = !x ? y : !y ? x : (x < y ? x : y);
    });

    // 每天的记录：取较大的数字，任一设备完成就算完成
    const da = a.days || {}, db = b.days || {};
    new Set([...Object.keys(da), ...Object.keys(db)]).forEach((k) => {
      const x = da[k] || {}, y = db[k] || {};
      out.days[k] = {
        newWords: Math.max(x.newWords || 0, y.newWords || 0),
        reviewed: Math.max(x.reviewed || 0, y.reviewed || 0),
        phrases: Math.max(x.phrases || 0, y.phrases || 0),
        done: !!(x.done || y.done),
      };
    });

    // 设置：用最近改过的那份
    const useB = (b.settingsAt || 0) > (a.settingsAt || 0);
    out.settings = Object.assign({}, useB ? b.settings : a.settings);
    out.settingsAt = Math.max(a.settingsAt || 0, b.settingsAt || 0);
    return out;
  }

  root.mergeProgress = mergeProgress;
})(typeof self !== "undefined" ? self : globalThis);
