// Stash 自动抓包脚本 V3 - 小鹏汽车
// 改进版：批量收集模式，精确URL匹配，不发送响应Body到服务器
// 适用于 Stash / Surge / Loon

const req = $request;
const url = req.url;
const reqHeaders = req.headers;

// 你的XPMATE服务器地址（需要修改为你的实际地址）
const SERVER_URL = 'http://192.168.1.43:3000/api/auto-capture-batch';
const CAPTURE_SESSION_TIMEOUT = 10 * 60 * 1000; // 10 minutes in milliseconds

// 精确定义需要捕获的5个API
const API_PATTERNS = [
    {
        // 4.1 Energy by Month (每月能耗)
        pattern: /^https:\/\/iot-web\.xiaopeng\.com\/api\/energy\/report\/day\/preview\/list\?vin=/,
        type: 'energy_by_month',
        name: 'Energy by Month',
        order: 1
    },
    {
        // 4.2 Energy by Day (每日能耗详情)
        pattern: /^https:\/\/iot-web\.xiaopeng\.com\/api\/energy\/report\/day\/detail\?vin=/,
        type: 'energy_by_day',
        name: 'Energy by Day',
        order: 2
    },
    {
        // 4.3 Trips Report (行程报告)
        pattern: /^https:\/\/iot-web\.xiaopeng\.com\/api\/trips_report\/web\/adTripsReport\/trips\/list\?vin=/,
        type: 'trips_report',
        name: 'Trips Report',
        order: 3
    },
    {
        // 4.4 Energy by Trip (行程能耗)
        pattern: /^https:\/\/iot-web\.xiaopeng\.com\/api\/energy\/report\/day\/driveSection\/list\?vin=/,
        type: 'energy_by_trip',
        name: 'Energy by Trip',
        order: 4
    },
    {
        // 4.5 Trips Report by Trip (行程详情)
        pattern: /^https:\/\/iot-web\.xiaopeng\.com\/api\/trips_report\/web\/adTripsReport\/trips\/detail\?vin=/,
        type: 'trips_report_by_trip',
        name: 'Trips Report by Trip',
        order: 5
    }
];

// 检查URL是否匹配需要捕获的API
function getApiType(url) {
    for (const api of API_PATTERNS) {
        if (api.pattern.test(url)) {
            return api;
        }
    }
    return null;
}

// 获取存储的捕获数据
function getCapturedData() {
    const stored = $persistentStore.read('xpeng_captured_apis');
    if (!stored) return { apis: {}, timestamp: Date.now() };

    try {
        const data = JSON.parse(stored);

        // Migration check
        if (typeof data.timestamp === 'undefined' || typeof data.apis === 'undefined') {
            console.log('🔄 检测到旧版数据格式，正在重置...');
            clearCapturedData();
            return { apis: {}, timestamp: Date.now() };
        }

        const now = Date.now();
        // Check for session timeout
        if (now - data.timestamp > CAPTURE_SESSION_TIMEOUT) {
            console.log(`⏰ 捕获会话已超时 (>10分钟)，清除旧数据`);
            clearCapturedData();
            return { apis: {}, timestamp: now };
        }

        return data;
    } catch (e) {
        console.log('⚠️ 数据解析失败，重置数据');
        clearCapturedData();
        return { apis: {}, timestamp: Date.now() };
    }
}

// 保存捕获数据
function saveCapturedData(data) {
    $persistentStore.write(JSON.stringify(data), 'xpeng_captured_apis');
}

// 清除捕获数据
function clearCapturedData() {
    $persistentStore.write(null, 'xpeng_captured_apis');
}

// 检查是否所有API都已捕获
function isAllCaptured(capturedData) {
    const requiredTypes = API_PATTERNS.map(api => api.type);
    return requiredTypes.every(type => capturedData[type]);
}

// 主逻辑
const apiInfo = getApiType(url);

// 特殊定义的触发上传URL (伪装成Xpeng API以匹配规则)
const MANUAL_UPLOAD_URL = 'https://iot-web.xiaopeng.com/api/xpmate/manual-upload';

// 检查是否是手动触发上传的URL
if (url.indexOf('xpmate/manual-upload') !== -1) {
    console.log('👆 收到手动上传指令');

    // 返回HTML页面的辅助函数
    const getHtml = (title, message, color) => `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
        <title>${title}</title>
        <style>
            body { font-family: -apple-system, sans-serif; padding: 20px; text-align: center; background: #f0f2f5; }
            .card { background: white; border-radius: 12px; padding: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
            h1 { color: ${color}; font-size: 20px; margin-bottom: 15px; }
            p { color: #666; font-size: 16px; line-height: 1.5; }
            .close { margin-top: 20px; font-size: 14px; color: #999; }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>${title}</h1>
            <p>${message}</p>
            <div class="close">您可以关闭此页面返回 APP</div>
        </div>
    </body>
    </html>`;

    const sessionData = getCapturedData();
    if (!sessionData || !sessionData.apis || Object.keys(sessionData.apis).length === 0) {
        console.log('⚠️ 没有可上传的数据');

        $done({
            response: {
                status: 200,
                headers: { 'Content-Type': 'text/html;charset=UTF-8' },
                body: getHtml('无需上传', '当前没有待上传的数据。<br>可能您刚刚已经上传成功了。', '#666')
            }
        });
    } else {
        const capturedCount = Object.keys(sessionData.apis).length;
        console.log(`📦 准备上传 ${capturedCount} 条数据...`);

        // 按顺序排列数据
        const sortedData = Object.values(sessionData.apis).sort((a, b) => a.order - b.order);

        // 发送到XPMATE服务器
        $httpClient.post({
            url: SERVER_URL,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                apis: sortedData,
                totalCount: sortedData.length
            }),
            timeout: 10 // 秒
        }, (error, response, data) => {
            if (error) {
                console.log(`❌ 发送失败: ${error}`);
                $notification.post('XPMATE', '上传失败', '请检查服务器地址是否可达');

                $done({
                    response: {
                        status: 200,
                        headers: { 'Content-Type': 'text/html;charset=UTF-8' },
                        body: getHtml('发送失败', `❌ 无法连接到服务器。<br>原因: ${error}`, '#f44336')
                    }
                });
            } else {
                console.log(`🎉 成功发送到XPMATE服务器`);
                clearCapturedData();
                $notification.post('XPMATE', '上传成功', `已发送 ${capturedCount} 条数据`);

                $done({
                    response: {
                        status: 200,
                        headers: { 'Content-Type': 'text/html;charset=UTF-8' },
                        body: getHtml('上传成功', `✅ 已成功发送 ${capturedCount} 条数据到服务器。<br>数据正在后台处理中。`, '#4caf50')
                    }
                });
            }
        });
    }
}
// 正常的API捕获逻辑
else if (apiInfo) {
    console.log(`🚗 [${apiInfo.order}/5] 捕获到: ${apiInfo.name}`);

    // 获取已捕获的数据
    let sessionData = getCapturedData();

    // 记录之前的捕获状态
    const prevCapturedTypes = Object.keys(sessionData.apis);

    // 保存当前捕获的API数据
    sessionData.apis[apiInfo.type] = {
        url: url,
        method: req.method || 'GET',
        headers: reqHeaders,
        body: req.body || null,
        type: apiInfo.type,
        order: apiInfo.order,
        timestamp: new Date().toISOString()
    };

    // 更新会话时间戳
    sessionData.timestamp = Date.now();
    saveCapturedData(sessionData);

    const capturedCount = Object.keys(sessionData.apis).length;
    console.log(`📊 已捕获: ${capturedCount}/5`);

    // 分组通知逻辑
    const notifyGroups = {
        'energy_by_month': { name: '月度能耗', standalone: true },
        'energy_by_day': { name: '每日能耗', pairWith: 'energy_by_trip' },
        'energy_by_trip': { name: '每日能耗', pairWith: 'energy_by_day', silent: true },
        'trips_report': { name: '月度行程', standalone: true },
        'trips_report_by_trip': { name: '每日行程', standalone: true }
    };

    const currentGroup = notifyGroups[apiInfo.type];
    let shouldNotify = false;
    let notifyName = currentGroup.name;

    if (currentGroup.standalone) {
        if (!prevCapturedTypes.includes(apiInfo.type)) {
            shouldNotify = true;
        }
    } else if (currentGroup.pairWith && !currentGroup.silent) {
        const hasPair = sessionData.apis[currentGroup.pairWith];
        const isNewCapture = !prevCapturedTypes.includes(apiInfo.type);
        // 如果自己是新捕获的，或者配对的那个存在且我也刚捕获到（或者是刚捕获到的配对触发了这个逻辑？不对，这里是当前请求处理）
        // 简单点：只要我是新捕获的，就通知。如果我是非静默的，我就负责通知。
        if (isNewCapture) {
            shouldNotify = true;
        }
    } else if (currentGroup.silent) {
        // 静默组：如果我是新捕获的，并且我的配对还没有捕获，那我就得通知（作为此组的第一个）
        // 或者：静默组永远不通知，只让主组通知？
        // 如果先抓到silent组，后抓到pair组，pair组会通知 "3/5" -> 正确。
        // 如果先抓到pair组，pair组会通知 "3/5" (其实只有1个)。然后在抓到silent组... silent组不通知？那用户怎么知道进度？
        // 应该：
        // 1. Silent组捕获时，如果Pair还没捕获，Silent组通知。
        // 2. Pair组捕获时，如果Silent还没捕获，Pair组通知。
        // 3. 如果两个都捕获了（不管谁后谁先），最后那个负责通知。

        // 优化逻辑：
        // 只要是新捕获的，就判断是否需要通知。
        // 对于成对的：
        // - 如果两个都齐了 -> 发送通知
        // - 如果只到了我自己（我是第一个） -> 发送通知
        shouldNotify = !prevCapturedTypes.includes(apiInfo.type);
    }

    // 检查是否所有API都已捕获
    if (isAllCaptured(sessionData.apis)) {
        console.log(`✅ 所有数据准备就绪，等待用户确认上传...`);

        $notification.post(
            'XPMATE 数据准备就绪',
            `已捕获 5/5 个请求`,
            '👆 点击此通知将数据传输到服务器',
            { url: MANUAL_UPLOAD_URL }
        );
    } else if (shouldNotify) {
        $notification.post(
            'XPMATE 数据抓取',
            `已抓${notifyName} (${capturedCount}/5)`,
            `还需要 ${5 - capturedCount} 个请求`
        );
        console.log(`📢 通知: 已抓${notifyName} (${capturedCount}/5)`);
    } else {
        console.log(`⏳ 等待其他API... (还需要 ${5 - capturedCount} 个)`);
    }

    $done({});
} else {
    $done({});
}
