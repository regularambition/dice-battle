/**
 * クライアント側でDate.now()により現在時刻を取得するのは
 * 端末時刻設定変更による不正が容易なためこちらを呼び出して現在時刻を取得する
 * @returns Time.Now World Time API 準拠のミリ秒単位UNIX時間
 */
async function getPublicServerTime() {
    let res = Date.now();
    let remaining_retry = 5;
    while (remaining_retry > 0) {
        --remaining_retry;
        try {
            // /ip エンドポイントを使うと、必ずutc_datetime（UTC時刻）が返る
            const response = await fetch("https://time.now/developer/api/ip");
            const data = await response.json();
            const serverDate = new Date(data.utc_datetime);
            const unixMillis = serverDate.getTime();
            res = unixMillis;
            break;
        } catch (err) {
            console.error(`サーバー時刻取得失敗（残り再試行回数: ${remaining_retry}）`);
        }
    }
    return res;
}
