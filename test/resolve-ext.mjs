/* tsc は拡張子を書き足さない。lib/ の import は "./types" のままなので、
   Node の ESM 解決に .js を補ってやる。
   これがあるおかげで、アプリのソースを Node 用に書き換えずにテストできる。 */
export async function resolve(specifier, context, next) {
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?[jt]s$/.test(specifier)) {
    try {
      return await next(specifier + ".js", context);
    } catch {
      /* 拡張子付きで見つからなければ元の指定で試す */
    }
  }
  return next(specifier, context);
}
