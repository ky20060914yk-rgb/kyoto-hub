/** Lower-cased NFKC without spaces: 「ﾋﾞｾｷﾌﾞﾝ Ａ」 and 「ビセキブン a」 compare equal. */
export const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
