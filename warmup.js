const https = require('https');

// ================= 配置区域 =================
// 换成你那个生成列表的 Worker 地址
const LIST_API = 'https://music-api.tming.cn'; 
// 并发数（建议 5-10，不要太高）
const CONCURRENCY = 5;
// ===========================================

// 发起 HTTPS 请求的辅助函数
function fetchUrl(url, isJson = false) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        // 伪装成 Mac 上的 Chrome，防止被拦截
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Connection': 'keep-alive'
      }
    };

    const req = https.get(url, options, (res) => {
      // 如果是下载文件，检查状态码
      if (!isJson && res.statusCode !== 200 && res.statusCode !== 206 && res.statusCode !== 304) {
        res.resume(); // 消耗掉流
        return reject(new Error(`Status Code: ${res.statusCode}`));
      }

      let data = '';
      
      // 如果是获取列表，我们需要拼接数据
      if (isJson) {
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      } else {
        // 如果是预热下载，我们不需要保存数据，只要让它流过网卡就行
        // data 事件必须监听，否则流不会开始传输
        res.on('data', () => {}); 
        res.on('end', () => {
          const cacheStatus = res.headers['cf-cache-status'] || 'MISS';
          resolve(cacheStatus);
        });
      }
    });

    req.on('error', (e) => reject(e));
    req.setTimeout(30000, () => { // 30秒超时
        req.destroy();
        reject(new Error('Timeout'));
    });
  });
}

async function start() {
  console.log('🚀 开始获取歌单...');
  
  try {
    const list = await fetchUrl(LIST_API, true);
    
    if (!Array.isArray(list)) {
      throw new Error('API 返回的不是数组');
    }

    const total = list.length;
    console.log(`📋 获取成功，共有 ${total} 首歌曲。开始预热...`);

    // 分批处理，控制并发
    for (let i = 0; i < total; i += CONCURRENCY) {
      const chunk = list.slice(i, i + CONCURRENCY);
      const promises = chunk.map(async (song) => {
        try {
          const start = Date.now();
          // 添加时间戳参数，确保每次 GitHub Actions 运行时不会命中 GitHub 本地的缓存
          // 注意：这不会影响 Cloudflare 缓存，因为 Cloudflare 缓存 key 通常不包含 query string (除非特殊设置)
          // 但为了保险，建议直接请求原链接，GitHub Actions 每次环境都是新的，没有本地缓存。
          const cacheStatus = await fetchUrl(song.url);
          const duration = ((Date.now() - start) / 1000).toFixed(2);
          
          console.log(`[${i + 1}/${total}] ${cacheStatus.padEnd(4)} | ${duration}s | ${song.name}`);
        } catch (err) {
          console.error(`❌ [ERROR] ${song.name}: ${err.message}`);
        }
      });

      // 等待这一批完成再进行下一批
      await Promise.all(promises);
    }

    console.log('✅ 所有歌曲预热完成！');

  } catch (err) {
    console.error('💥 脚本运行失败:', err);
    process.exit(1);
  }
}

start();
