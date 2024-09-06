/*
 * https://github.com/netnr/workers
 *
 * 2019-2022
 * netnr
 *
 * https://github.com/Rongronggg9/rsstt-img-relay
 *
 * 2021-2024
 * Rongronggg9
 */

/**
 * Configurations
 */
const config = {
    selfURL: "", // to be filled later
    URLRegExp: "^(\\w+://.+?)/(.*)$",
    // 从 https://sematext.com/ 申请并修改令牌
    sematextToken: "00000000-0000-0000-0000-000000000000",
    // 是否丢弃请求中的 Referer，在目标网站应用防盗链时有用
    dropReferer: true,
    // weibo workarounds
    weiboCDN: [".weibocdn.com", ".sinaimg.cn"],
    weiboReferer: "https://weibo.com/",
    // sspai workarounds
    sspaiCDN: [".sspai.com"],
    sspaiReferer: "https://sspai.com/",
    // 黑名单，URL 中含有任何一个关键字都会被阻断
    // blockList: [".m3u8", ".ts", ".acc", ".m4s", "photocall.tv", "googlevideo.com", "liveradio.ie"],
    blockList: [],
    typeList: ["image", "video", "audio", "application", "font", "model"],
};

/**
 * Set config from environmental variables
 * @param {object} env
 */
function setConfig(env) {
    Object.keys(config).forEach((k) => {
        if (env[k])
            config[k] = typeof config[k] === 'string' ? env[k] : JSON.parse(env[k]);
    });
}

/**
 * Event handler for fetchEvent
 * @param {Request} request
 * @param {object} env
 * @param {object} ctx
 */
async function fetchHandler(request, env, ctx) {
    ctx.passThroughOnException();
    setConfig(env);

    //请求头部、返回对象
    let reqHeaders = new Headers(request.headers),
        outBody, outStatus = 200, outStatusText = 'OK', outCt = null, outHeaders = new Headers({
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": reqHeaders.get('Access-Control-Allow-Headers') || "Accept, Authorization, Cache-Control, Content-Type, DNT, If-Modified-Since, Keep-Alive, Origin, User-Agent, X-Requested-With, Token, x-access-token"
        });

    try {
        const urlMatch = request.url.match(RegExp(config.URLRegExp));
        config.selfURL = urlMatch[1];
        let url = urlMatch[2];

        url = decodeURIComponent(url);

        //需要忽略的代理
        if (request.method == "OPTIONS" || url.length < 3 || url.indexOf('.') == -1 || url == "favicon.ico" || url == "robots.txt") {
            //输出提示
            const invalid = !(request.method == "OPTIONS" || url.length === 0)
            outBody = JSON.stringify({
                code: invalid ? 400 : 0,
                usage: 'Host/{URL}',
                source: 'https://github.com/Rongronggg9/rsstt-img-relay'
            });
            outCt = "application/json";
            outStatus = invalid ? 400 : 200;
        }
        //阻断
        else if (blockUrl(url)) {
            outBody = JSON.stringify({
                code: 403,
                msg: 'The keyword: ' + config.blockList.join(' , ') + ' was block-listed by the operator of this proxy.'
            });
            outCt = "application/json";
            outStatus = 403;
        }
        else {
            url = fixUrl(url);

            //构建 fetch 参数
            let fp = {
                method: request.method,
                headers: {}
            }

            //保留头部其它信息
            const dropHeaders = ['content-length', 'content-type', 'host'];
            if (config.dropReferer) dropHeaders.push('referer');
            let he = reqHeaders.entries();
            for (let h of he) {
                const key = h[0], value = h[1];
                if (!dropHeaders.includes(key)) {
                    fp.headers[key] = value;
                }
            }
            if (config.dropReferer) {
                const urlObj = new URL(url);
                if (config.weiboCDN.some(x => urlObj.host.endsWith(x))) {
                    // apply weibo workarounds
                    fp.headers['referer'] = config.weiboReferer;
                } else if (config.sspaiCDN.some(x => urlObj.host.endsWith(x))) {
                    // apply sspai workarounds
                    fp.headers['referer'] = config.sspaiReferer;
                }
            }

            // 是否带 body
            if (["POST", "PUT", "PATCH", "DELETE"].indexOf(request.method) >= 0) {
                const ct = (reqHeaders.get('content-type') || "").toLowerCase();
                if (ct.includes('application/json')) {
                    fp.body = JSON.stringify(await request.json());
                } else if (ct.includes('application/text') || ct.includes('text/html')) {
                    fp.body = await request.text();
                } else if (ct.includes('form')) {
                    fp.body = await request.formData();
                } else {
                    fp.body = await request.blob();
                }
            }

            // 发起 fetch
            let fr = (await fetch(url, fp));
            outCt = fr.headers.get('content-type');
            // 阻断
            if (blockType(outCt)) {
                outBody = JSON.stringify({
                    code: 415,
                    msg: 'The keyword "' + config.typeList.join(' , ') + '" was whitelisted by the operator of this proxy, but got "' + outCt + '".'
                });
                outCt = "application/json";
                outStatus = 415;
            }
            else {
                outStatus = fr.status;
                outStatusText = fr.statusText;
                outBody = fr.body;
                const overrideHeaders = new Set(outHeaders.keys())
                for (let h of fr.headers.entries()) {
                    if (!overrideHeaders.has(h[0]))
                        outHeaders.set(h[0], h[1]);
                }
            }
        }
    } catch (err) {
        outCt = "application/json";
        outBody = JSON.stringify({
            code: -1,
            msg: JSON.stringify(err.stack) || err
        });
        outStatus = 500;
    }

    //设置类型
    if (outCt && outCt != "") {
        outHeaders.set("content-type", outCt);
    }

    if (outStatus < 400)
        outHeaders.set("cache-control", "public, max-age=604800");

    let response = new Response(outBody, {
        status: outStatus,
        statusText: outStatusText,
        headers: outHeaders
    })

    //日志接口
    if (config.sematextToken != "00000000-0000-0000-0000-000000000000") {
        sematext.add(ctx, request, response);
    }

    return response;

    // return new Response('OK', { status: 200 })
}

// 补齐 url
function fixUrl(url) {
    if (url.includes("://")) {
        return url;
    } else if (url.includes(':/')) {
        return url.replace(':/', '://');
    } else {
        return "http://" + url;
    }
}

// 阻断 url
function blockUrl(url) {
    url = url.toLowerCase();
    let len = config.blockList.filter(x => url.includes(x)).length;
    return len != 0;
}
// 阻断 type
function blockType(type) {
    type = type.toLowerCase();
    let len = config.typeList.filter(x => type.includes(x)).length;
    return len == 0;
}

/**
 * 日志
 */
const sematext = {

    /**
     * 构建发送主体
     * @param {any} request
     * @param {any} response
     */
    buildBody: (request, response) => {
        const hua = request.headers.get("user-agent")
        const hip = request.headers.get("cf-connecting-ip")
        const hrf = request.headers.get("referer")
        const url = new URL(request.url)

        const body = {
            method: request.method,
            statusCode: response.status,
            clientIp: hip,
            referer: hrf,
            userAgent: hua,
            host: url.host,
            path: url.pathname,
            proxyHost: null,
        }

        if (body.path.includes(".") && body.path != "/" && !body.path.includes("favicon.ico")) {
            try {
                let purl = fixUrl(decodeURIComponent(body.path.substring(1)));

                body.path = purl;
                body.proxyHost = new URL(purl).host;
            } catch { }
        }

        return {
            method: "POST",
            body: JSON.stringify(body)
        }
    },

    /**
     * 添加
     * @param {any} event
     * @param {any} request
     * @param {any} response
     */
    add: (event, request, response) => {
        let url = `https://logsene-receiver.sematext.com/${config.sematextToken}/example/`;
        const body = sematext.buildBody(request, response);

        event.waitUntil(fetch(url, body))
    }
};

export default {
    fetch: fetchHandler
};
