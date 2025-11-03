const express = require('express');
const axios = require('axios');
const router = express.Router();

/**
 * WebView 代理接口
 * 用于代理无法配置为业务域名的页面
 * 接口地址: GET /api/webview/proxy
 * 请求参数:
 *   - targetUrl (string, required): 要代理的目标URL（收银台URL）
 *   - authorization (string, optional): Authorization 头值（Bearer token）
 */
router.get('/proxy', async (req, res) => {
  try {
    const { targetUrl, authorization } = req.query;
    
    if (!targetUrl) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: 'targetUrl参数不能为空'
      });
    }

    // 解码URL
    const decodedTargetUrl = decodeURIComponent(targetUrl);
    
    console.log('代理请求:', decodedTargetUrl);
    console.log('Authorization:', authorization ? '已提供' : '未提供');

    // 验证URL格式
    try {
      const urlObj = new URL(decodedTargetUrl);
      // 只允许http和https协议
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        return res.status(400).json({
          code: 400,
          status: false,
          message: '只支持http和https协议'
        });
      }
    } catch (e) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: '无效的URL格式'
      });
    }

    // 构建请求头，只使用用户明确提供的 authorization（必须是 Bearer token）
    const requestHeaders = {
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': req.headers['accept-language'] || 'zh-CN,zh;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Referer': decodedTargetUrl,
      'Cache-Control': 'no-cache',
    };
    
    // 只在明确提供有效 authorization 且是 Bearer token 时才添加
    // 过滤掉 "Bearer null" 或其他无效值，并处理包含多个值的情况
    // 不使用 Basic Auth，因为可能导致不必要的重定向
    if (authorization && authorization.trim()) {
      let authValue = authorization.trim();
      
      // 处理包含逗号分隔的多个值的情况（如 "Bearer null, Bearer token"）
      // 提取最后一个有效的 Bearer token
      if (authValue.includes(',')) {
        const parts = authValue.split(',').map(p => p.trim()).filter(p => p);
        // 从后往前查找，找到第一个有效的 Bearer token
        for (let i = parts.length - 1; i >= 0; i--) {
          const part = parts[i];
          const lowerPart = part.toLowerCase();
          // 跳过无效值
          if (lowerPart !== 'null' && 
              lowerPart !== 'undefined' && 
              !lowerPart.startsWith('bearer null') && 
              !lowerPart.startsWith('bearer undefined') &&
              lowerPart !== '' &&
              lowerPart !== 'bearer' &&
              part.length > 10) { // 确保 token 长度合理
            authValue = part;
            break;
          }
        }
      }
      
      // 处理 "Bearer null, Bearer token" 这种格式（提取逗号后的部分）
      if (authValue.toLowerCase().includes('bearer null,')) {
        const afterComma = authValue.split(/bearer null\s*,/i)[1];
        if (afterComma && afterComma.trim()) {
          authValue = afterComma.trim();
        }
      }
      
      // 检查是否是无效值（如 "Bearer null", "null", "undefined" 等）
      const lowerAuth = authValue.toLowerCase();
      const isInvalid = lowerAuth === 'null' || 
                       lowerAuth === 'undefined' || 
                       lowerAuth === 'bearer null' || 
                       lowerAuth === 'bearer undefined' ||
                       lowerAuth === '' ||
                       lowerAuth === 'bearer' ||
                       (lowerAuth.startsWith('bearer null') && !lowerAuth.includes(',')) ||
                       (lowerAuth.startsWith('bearer undefined') && !lowerAuth.includes(','));
      
      if (!isInvalid && authValue.length > 10) {
        // 确保是 Bearer token 格式
        if (authValue.startsWith('Bearer ') || authValue.startsWith('bearer ')) {
          // 再次检查 token 部分是否有效（不是 "null" 或 "undefined"）
          const tokenPart = authValue.substring(7).trim();
          if (tokenPart && 
              tokenPart.toLowerCase() !== 'null' && 
              tokenPart.toLowerCase() !== 'undefined') {
            requestHeaders['Authorization'] = authValue;
          }
        } else {
          // 如果没有 Bearer 前缀，自动添加
          if (authValue.toLowerCase() !== 'null' && authValue.toLowerCase() !== 'undefined') {
            requestHeaders['Authorization'] = `Bearer ${authValue}`;
          }
        }
      }
      // 如果是无效值，不添加 Authorization 头
    }

    // 请求目标页面
    // 注意：不使用 axios 的 auth 配置选项，避免自动添加 Basic Auth
    const response = await axios.get(decodedTargetUrl, {
      headers: requestHeaders,
      maxRedirects: 3, // 允许必要的重定向（如 HTTP->HTTPS），但限制次数避免意外跳转
      timeout: 30000,
      responseType: 'text',
      validateStatus: (status) => status < 500, // 不抛出4xx错误
      // 明确不使用 auth 配置，避免 axios 自动添加 Basic Auth
      auth: undefined,
    });

    let htmlContent = response.data;

    // 如果是HTML内容，需要处理相对路径和跨域问题
    if (htmlContent && typeof htmlContent === 'string' && 
        (htmlContent.includes('<!DOCTYPE') || htmlContent.includes('<html') || htmlContent.includes('<HTML'))) {
      
      const targetBaseUrl = new URL(decodedTargetUrl);
      const baseOrigin = `${targetBaseUrl.protocol}//${targetBaseUrl.host}`;
      // 使用 origin + pathname，避免包含 hash 和 query，因为 hash 不应该在 base href 中
      // 确保 pathname 以斜杠结尾，这样相对路径才能正确解析
      let baseHref = `${targetBaseUrl.origin}${targetBaseUrl.pathname}`;
      if (!baseHref.endsWith('/')) {
        // 如果 pathname 不以斜杠结尾，添加斜杠
        baseHref += '/';
      }
      
      // 提取 hash 和 search，用于在页面加载后设置正确的路由
      // 注意：从目标 URL 中提取，而不是从当前代理 URL 中提取
      const targetHash = targetBaseUrl.hash || '';
      const targetSearch = targetBaseUrl.search || '';
      // 组合 hash 和 search（hash 中可能已包含 query 参数）
      // 如果 hash 中包含 ?，则 search 已经在 hash 中了
      let targetRoute = targetHash;
      if (targetHash && !targetHash.includes('?') && targetSearch) {
        // 如果 hash 中没有 query 参数，但 search 有，则合并
        targetRoute = targetHash + targetSearch;
      } else if (!targetHash && targetSearch) {
        // 如果没有 hash 但有 search，使用 search
        targetRoute = targetSearch;
      }

      // 1. 注入 CSP meta 标签和修复脚本，必须在 head 的最前面，在所有其他脚本之前执行
      // 使用宽松的 CSP 策略以支持代理页面
      const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; script-src * 'unsafe-inline' 'unsafe-eval'; style-src * 'unsafe-inline'; img-src * data: blob:; font-src * data:; connect-src *; base-uri *; frame-src *;">`;

      // 2. 添加base标签确保资源路径正确（使用原始服务器路径）
      if (!htmlContent.includes('<base') && !htmlContent.includes('<BASE')) {
        // 查找head标签，如果找不到就在开头添加
        if (htmlContent.includes('<head>') || htmlContent.includes('<HEAD>')) {
          htmlContent = htmlContent.replace(
            /<head>/i,
            `<head>${cspMeta}<base href="${baseHref}" />`
          );
        } else if (htmlContent.includes('<html>') || htmlContent.includes('<HTML>')) {
          htmlContent = htmlContent.replace(
            /<html[^>]*>/i,
            `$&<head>${cspMeta}<base href="${baseHref}" /></head>`
          );
        } else {
          // 如果没有head标签，在开头添加
          htmlContent = `<head>${cspMeta}<base href="${baseHref}" /></head>${htmlContent}`;
        }
      } else {
        // 如果已经有 base 标签，只添加 CSP meta
        if (htmlContent.includes('<head>') || htmlContent.includes('<HEAD>')) {
          htmlContent = htmlContent.replace(
            /<head>/i,
            `<head>${cspMeta}`
          );
        }
      }

      // 注意：不要修改 HTML 中的路径，让浏览器通过 base 标签自动处理
      // 这样可以确保所有静态资源都从原始服务器加载，而不是代理服务器

      // 3. 注入脚本，用于处理后续的API请求和路由问题
      const injectScript = `
        <script>
          (function() {
            // 保存原始API
            const originalFetch = window.fetch;
            const originalXHR = window.XMLHttpRequest;
            const originalReplaceState = history.replaceState;
            const originalPushState = history.pushState;
            const currentOrigin = window.location.origin;
            
            // 设置正确的路由 hash（如果目标 URL 包含 hash）
            // 小程序 webview 环境优化：必须在 Vue Router 初始化之前执行
            ${targetRoute ? `
            (function() {
              try {
                // 目标路由值
                const targetRoute = '${targetRoute.replace(/'/g, "\\'")}';
                
                // 从代理 URL 的查询参数中提取 targetUrl（如果存在）
                // 这样可以确保使用的是正确的 hash，而不是代理 URL 本身的 hash
                function getTargetHashFromUrl() {
                  try {
                    const urlParams = new URLSearchParams(window.location.search);
                    const targetUrlParam = urlParams.get('targetUrl');
                    if (targetUrlParam) {
                      const decodedUrl = decodeURIComponent(targetUrlParam);
                      const urlObj = new URL(decodedUrl);
                      return urlObj.hash || '';
                    }
                  } catch(e) {
                    console.warn('从 URL 参数提取 hash 失败:', e);
                  }
                  return null;
                }
                
                // 优先从 URL 参数中获取，如果没有则使用目标路由
                let finalHash = getTargetHashFromUrl();
                if (!finalHash) {
                  finalHash = targetRoute;
                }
                
                // 小程序 webview 环境：立即设置 hash，使用多种方式确保成功
                function setHash() {
                  if (!finalHash) return;
                  
                  try {
                    // 方式1：直接设置 hash（最简单，兼容性最好）
                    if (window.location.hash !== finalHash) {
                      // 如果当前 hash 为空或者是默认的，直接设置
                      if (!window.location.hash || window.location.hash === '#' || window.location.hash === '#/') {
                        window.location.hash = finalHash;
                      } else {
                        // 如果已有 hash，使用 replace 方式
                        const currentUrl = window.location.href.split('#')[0];
                        window.location.replace(currentUrl + finalHash);
                      }
                    }
                  } catch(e) {
                    console.warn('设置 hash 失败:', e);
                  }
                }
                
                // 立即执行一次
                setHash();
                
                // 小程序 webview 可能有时序问题，多次尝试设置
                // DOMContentLoaded 时再设置一次
                if (document.readyState === 'loading') {
                  document.addEventListener('DOMContentLoaded', function() {
                    setTimeout(setHash, 100);
                  });
                } else {
                  // 文档已加载，延迟设置确保 Vue Router 能正确识别
                  setTimeout(setHash, 100);
                }
                
                // 额外延迟设置，确保在所有脚本加载后也能正确设置
                setTimeout(setHash, 300);
                
              } catch(e) {
                console.warn('初始化路由 hash 失败:', e);
              }
            })();
            ` : ''}
            
            // 修复 History API 跨域问题
            // 确保所有 state 操作都使用当前页面的 origin
            function normalizeUrl(url) {
              if (!url) return url;
              try {
                // 如果是绝对 URL，检查是否是跨域的
                if (url.startsWith('http://') || url.startsWith('https://')) {
                  const urlObj = new URL(url);
                  // 如果是跨域，只保留 pathname + search + hash，使用当前 origin
                  if (urlObj.origin !== currentOrigin) {
                    return currentOrigin + urlObj.pathname + urlObj.search + urlObj.hash;
                  }
                } else {
                  // 相对路径，确保以 / 开头
                  return url.startsWith('/') ? url : '/' + url;
                }
              } catch (e) {
                // URL 解析失败，返回相对路径
                return url.startsWith('/') ? url : '/' + url;
              }
              return url;
            }
            
            // 拦截 replaceState
            history.replaceState = function(state, title, url) {
              try {
                const normalizedUrl = normalizeUrl(url);
                return originalReplaceState.call(this, state, title, normalizedUrl);
              } catch (e) {
                // 如果失败，尝试只使用 pathname
                try {
                  if (url) {
                    const urlObj = url.startsWith('http') ? new URL(url) : new URL(url, currentOrigin);
                    const pathOnly = urlObj.pathname + urlObj.search + urlObj.hash;
                    return originalReplaceState.call(this, state, title, pathOnly);
                  } else {
                    return originalReplaceState.call(this, state, title, url);
                  }
                } catch (e2) {
                  // 如果还是失败，不传 URL
                  return originalReplaceState.call(this, state, title);
                }
              }
            };
            
            // 拦截 pushState
            history.pushState = function(state, title, url) {
              try {
                const normalizedUrl = normalizeUrl(url);
                return originalPushState.call(this, state, title, normalizedUrl);
              } catch (e) {
                // 如果失败，尝试只使用 pathname
                try {
                  if (url) {
                    const urlObj = url.startsWith('http') ? new URL(url) : new URL(url, currentOrigin);
                    const pathOnly = urlObj.pathname + urlObj.search + urlObj.hash;
                    return originalPushState.call(this, state, title, pathOnly);
                  } else {
                    return originalPushState.call(this, state, title, url);
                  }
                } catch (e2) {
                  // 如果还是失败，不传 URL
                  return originalPushState.call(this, state, title);
                }
              }
            };
            
            // 拦截fetch请求，添加Authorization头
            if (originalFetch) {
              window.fetch = function(...args) {
                const url = args[0];
                const options = args[1] || {};
                options.headers = options.headers || {};
                ${authorization ? `options.headers['Authorization'] = '${authorization.replace(/'/g, "\\'")}';` : ''}
                return originalFetch.apply(this, [url, options]);
              };
            }
            
            // 拦截XMLHttpRequest，添加Authorization头
            if (originalXHR) {
              const XHRConstructor = function() {
                const xhr = new originalXHR();
                const originalOpen = xhr.open;
                const originalSend = xhr.send;
                const originalSetRequestHeader = xhr.setRequestHeader;
                
                xhr.open = function(method, url, ...rest) {
                  this._url = url;
                  return originalOpen.apply(this, [method, url, ...rest]);
                };
                
                xhr.setRequestHeader = function(header, value) {
                  originalSetRequestHeader.call(this, header, value);
                };
                
                xhr.send = function(data) {
                  ${authorization ? `try { this.setRequestHeader('Authorization', '${authorization.replace(/'/g, "\\'")}'); } catch(e) {}` : ''}
                  return originalSend.apply(this, [data]);
                };
                
                return xhr;
              };
              
              // 复制所有属性
              Object.keys(originalXHR).forEach(key => {
                try {
                  XHRConstructor[key] = originalXHR[key];
                } catch(e) {}
              });
              
              // 复制原型属性
              if (originalXHR.prototype) {
                Object.getOwnPropertyNames(originalXHR.prototype).forEach(key => {
                  try {
                    XHRConstructor.prototype[key] = originalXHR.prototype[key];
                  } catch(e) {}
                });
              }
              
              window.XMLHttpRequest = XHRConstructor;
            }
          })();
        </script>
      `;
      
      // 将脚本注入到head标签的开头（在base标签之后），确保在其他脚本之前执行
      // 这样可以拦截 Vue Router 的初始化
      if (htmlContent.includes('<base') || htmlContent.includes('<BASE')) {
        // 在 base 标签之后插入
        htmlContent = htmlContent.replace(
          /(<base[^>]*>)/i,
          `$1${injectScript}`
        );
      } else if (htmlContent.includes('<head>') || htmlContent.includes('<HEAD>')) {
        // 如果没有 base 标签，在 head 开头插入（在 CSP meta 之后）
        htmlContent = htmlContent.replace(
          /(<head[^>]*>)/i,
          `$1${injectScript}`
        );
      } else if (htmlContent.includes('</head>') || htmlContent.includes('</HEAD>')) {
        // 如果找不到 head 开始标签，插入到 head 结束之前
        htmlContent = htmlContent.replace(/<\/head>/i, injectScript + '</head>');
      } else if (htmlContent.includes('</body>') || htmlContent.includes('</BODY>')) {
        // 如果没有head标签，添加到body之前
        htmlContent = htmlContent.replace(/<\/body>/i, injectScript + '</body>');
      } else {
        // 如果都没有，添加到html标签之后
        htmlContent = htmlContent.replace(/<\/html>/i, injectScript + '</html>');
      }
    }

    // 设置响应头
    const contentType = response.headers['content-type'] || 'text/html; charset=utf-8';
    res.setHeader('Content-Type', contentType);
    
    // 设置CORS头（如果需要）
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // 移除或覆盖严格的 CSP 头（让页面使用我们注入的 meta CSP）
    // 必须在发送响应前移除
    res.removeHeader('Content-Security-Policy');
    res.removeHeader('content-security-policy');
    
    // 拦截响应发送，确保 CSP 头被移除
    const originalSend = res.send;
    res.send = function(data) {
      // 再次确保移除 CSP 头
      this.removeHeader('Content-Security-Policy');
      this.removeHeader('content-security-policy');
      // 调用原始的 send 方法
      return originalSend.call(this, data);
    };
    
    // 返回内容
    res.status(response.status).send(htmlContent);

  } catch (error) {
    console.error('代理请求失败:', error);
    
    if (error.response) {
      // 如果目标服务器返回了错误，转发错误信息和状态码
      const contentType = error.response.headers['content-type'] || 'text/html; charset=utf-8';
      res.setHeader('Content-Type', contentType);
      res.status(error.response.status || 500).send(error.response.data || '代理请求失败');
    } else if (error.code === 'ECONNABORTED') {
      res.status(504).json({
        code: 504,
        status: false,
        message: '请求超时'
      });
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      res.status(502).json({
        code: 502,
        status: false,
        message: '无法连接到目标服务器'
      });
    } else {
      res.status(500).json({
        code: 500,
        status: false,
        message: '代理请求失败: ' + (error.message || '未知错误')
      });
    }
  }
});

module.exports = router;

