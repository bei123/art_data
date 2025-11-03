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

    // 请求目标页面
    const response = await axios.get(decodedTargetUrl, {
      headers: {
        ...(authorization ? { 'Authorization': authorization } : {}),
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': req.headers['accept-language'] || 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': decodedTargetUrl,
        'Cache-Control': 'no-cache',
      },
      maxRedirects: 5,
      timeout: 30000,
      responseType: 'text',
      validateStatus: (status) => status < 500, // 不抛出4xx错误
    });

    let htmlContent = response.data;

    // 如果是HTML内容，需要处理相对路径和跨域问题
    if (htmlContent && typeof htmlContent === 'string' && 
        (htmlContent.includes('<!DOCTYPE') || htmlContent.includes('<html') || htmlContent.includes('<HTML'))) {
      
      const targetBaseUrl = new URL(decodedTargetUrl);
      const baseOrigin = `${targetBaseUrl.protocol}//${targetBaseUrl.host}`;
      const baseHref = decodedTargetUrl;

      // 1. 添加base标签确保资源路径正确
      if (!htmlContent.includes('<base') && !htmlContent.includes('<BASE')) {
        // 查找head标签，如果找不到就在开头添加
        if (htmlContent.includes('<head>') || htmlContent.includes('<HEAD>')) {
          htmlContent = htmlContent.replace(
            /<head>/i,
            `<head><base href="${baseHref}" />`
          );
        } else if (htmlContent.includes('<html>') || htmlContent.includes('<HTML>')) {
          htmlContent = htmlContent.replace(
            /<html[^>]*>/i,
            `$&<head><base href="${baseHref}" /></head>`
          );
        } else {
          // 如果没有head标签，在开头添加
          htmlContent = `<head><base href="${baseHref}" /></head>${htmlContent}`;
        }
      }

      // 2. 将相对路径转换为绝对路径（处理src、href、action属性）
      // 处理以/开头的绝对路径
      htmlContent = htmlContent.replace(
        /(src|href|action)=["'](\/[^"']+)/gi,
        `$1="${baseOrigin}$2"`
      );

      // 处理相对路径（不以http://、https://、/、#、javascript:、data:开头）
      htmlContent = htmlContent.replace(
        /(src|href|action)=["'](?!https?:\/\/|#|javascript:|data:|\/)([^"']+)/gi,
        (match, attr, path) => {
          // 处理相对路径
          const fullPath = new URL(path, baseHref).href;
          return `${attr}="${fullPath}"`;
        }
      );

      // 3. 注入脚本，用于处理后续的API请求（如果需要）
      const injectScript = `
        <script>
          (function() {
            // 保存原始fetch和XMLHttpRequest
            const originalFetch = window.fetch;
            const originalXHR = window.XMLHttpRequest;
            
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
      
      // 将脚本注入到head标签的末尾
      if (htmlContent.includes('</head>') || htmlContent.includes('</HEAD>')) {
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

