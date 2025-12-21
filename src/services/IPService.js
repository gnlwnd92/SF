/**
 * IPService - IP 주소 관리 서비스
 * 
 * 브라우저의 현재 IP 주소를 가져오는 기능 제공
 */

const chalk = require('chalk');

class IPService {
  constructor(config = {}) {
    this.config = {
      debugMode: config.debugMode || false,
      timeout: config.timeout || 10000,
      ...config
    };
  }

  /**
   * 브라우저에서 현재 IP 주소 가져오기
   */
  async getCurrentIP(page) {
    try {
      if (this.config.debugMode) {
        console.log(chalk.gray('IP 주소 확인 중...'));
      }

      // 방법 1: AdsPower 시작 페이지에서 IP 추출 (우선순위 최상)
      try {
        const currentUrl = await page.url();
        
        // AdsPower 시작 페이지인지 확인
        if (currentUrl.includes('start.adspower.net')) {
          if (this.config.debugMode) {
            console.log(chalk.gray('AdsPower 시작 페이지에서 IP 추출 시도...'));
          }
          
          // IP 주소 추출 (큰 글씨로 표시되는 IP)
          const adsPowerIP = await page.evaluate(() => {
            // 방법 1: 클래스명으로 찾기
            const ipElements = document.querySelectorAll('.ip-address, .ip, [class*="ip"]');
            for (const el of ipElements) {
              const text = el.textContent.trim();
              const ipMatch = text.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
              if (ipMatch) {
                return ipMatch[0];
              }
            }
            
            // 방법 2: 큰 폰트 사이즈를 가진 요소에서 찾기
            const allElements = document.querySelectorAll('*');
            for (const el of allElements) {
              const style = window.getComputedStyle(el);
              const fontSize = parseInt(style.fontSize);
              if (fontSize > 30) { // 큰 글씨
                const text = el.textContent.trim();
                const ipMatch = text.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
                if (ipMatch) {
                  return ipMatch[0];
                }
              }
            }
            
            // 방법 3: 페이지 전체에서 IP 패턴 찾기
            const bodyText = document.body.innerText;
            const ipMatches = bodyText.match(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g);
            if (ipMatches && ipMatches.length > 0) {
              // 첫 번째로 발견된 IP 반환 (보통 가장 크게 표시됨)
              return ipMatches[0];
            }
            
            return null;
          });
          
          if (adsPowerIP && this.isValidIP(adsPowerIP)) {
            if (this.config.debugMode) {
              console.log(chalk.green(`✅ AdsPower IP 주소: ${adsPowerIP}`));
            }
            return adsPowerIP;
          }
        } else {
          // AdsPower 시작 페이지가 아닌 경우, 해당 페이지로 이동 시도
          if (this.config.debugMode) {
            console.log(chalk.gray('AdsPower 시작 페이지로 이동 시도...'));
          }
          
          try {
            // 현재 페이지 URL 저장
            const originalUrl = currentUrl;
            
            // AdsPower 시작 페이지로 이동
            await page.goto('https://start.adspower.net', {
              waitUntil: 'domcontentloaded',
              timeout: 10000
            });
            
            // 잠시 대기 (페이지 로딩 완료)
            await new Promise(r => setTimeout(r, 2000));
            
            // IP 추출
            const adsPowerIP = await page.evaluate(() => {
              // IP 요소 찾기
              const allElements = document.querySelectorAll('*');
              for (const el of allElements) {
                const text = el.textContent.trim();
                // IP 패턴 매칭 (독립된 IP 주소)
                if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(text)) {
                  const style = window.getComputedStyle(el);
                  const fontSize = parseInt(style.fontSize);
                  // 큰 글씨로 표시된 IP 우선
                  if (fontSize > 20) {
                    return text;
                  }
                }
              }
              
              // 페이지 내 모든 IP 패턴 찾기
              const bodyText = document.body.innerText;
              const ipMatches = bodyText.match(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g);
              return ipMatches ? ipMatches[0] : null;
            });
            
            // 원래 페이지로 돌아가기
            if (originalUrl && !originalUrl.includes('start.adspower.net')) {
              await page.goto(originalUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 10000
              });
            }
            
            if (adsPowerIP && this.isValidIP(adsPowerIP)) {
              if (this.config.debugMode) {
                console.log(chalk.green(`✅ AdsPower IP 주소: ${adsPowerIP}`));
              }
              return adsPowerIP;
            }
          } catch (error) {
            if (this.config.debugMode) {
              console.log(chalk.yellow('AdsPower 페이지 접근 실패, 대체 방법 시도...'));
            }
          }
        }
      } catch (error) {
        if (this.config.debugMode) {
          console.log(chalk.yellow('AdsPower IP 추출 실패, 대체 방법 시도...'));
        }
      }

      // 방법 2: ipify API 사용 (대체 방법)
      try {
        const response = await page.evaluate(async () => {
          try {
            const res = await fetch('https://api.ipify.org?format=json');
            const data = await res.json();
            return data.ip;
          } catch (error) {
            return null;
          }
        });

        if (response && this.isValidIP(response)) {
          if (this.config.debugMode) {
            console.log(chalk.green(`✅ IP 주소 (ipify): ${response}`));
          }
          return response;
        }
      } catch (error) {
        // ipify 실패 시 다음 방법 시도
      }

      // 방법 3: httpbin.org 사용
      try {
        const originalUrl = await page.url();
        await page.goto('https://httpbin.org/ip', {
          waitUntil: 'domcontentloaded',
          timeout: this.config.timeout
        });

        const ipData = await page.evaluate(() => {
          const preElement = document.querySelector('pre');
          if (preElement) {
            try {
              const data = JSON.parse(preElement.textContent);
              return data.origin;
            } catch (e) {
              return null;
            }
          }
          return null;
        });

        // 원래 페이지로 돌아가기
        if (originalUrl) {
          await page.goto(originalUrl, {
            waitUntil: 'domcontentloaded',
            timeout: this.config.timeout
          });
        }

        if (ipData) {
          // 복수 IP인 경우 첫 번째 IP만 반환
          const ip = ipData.split(',')[0].trim();
          if (this.isValidIP(ip)) {
            if (this.config.debugMode) {
              console.log(chalk.green(`✅ IP 주소 (httpbin): ${ip}`));
            }
            return ip;
          }
        }
      } catch (error) {
        // httpbin 실패 시
      }

      // 모든 방법 실패
      if (this.config.debugMode) {
        console.log(chalk.yellow('⚠️ IP 주소를 가져올 수 없습니다'));
      }
      return null;

    } catch (error) {
      if (this.config.debugMode) {
        console.error(chalk.red('IP 주소 확인 실패:'), error.message);
      }
      return null;
    }
  }

  /**
   * IP 주소 유효성 검사
   */
  isValidIP(ip) {
    if (!ip) return false;
    
    // IPv4 패턴
    const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
    
    if (!ipv4Pattern.test(ip)) {
      // IPv6도 지원
      const ipv6Pattern = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
      return ipv6Pattern.test(ip);
    }
    
    // IPv4 각 옥텟 범위 확인
    const parts = ip.split('.');
    return parts.every(part => {
      const num = parseInt(part);
      return num >= 0 && num <= 255;
    });
  }

  /**
   * IP 주소에서 국가 정보 가져오기 (선택적)
   */
  async getIPInfo(ip) {
    try {
      if (!this.isValidIP(ip)) {
        return null;
      }

      // ip-api.com 무료 서비스 사용 (상업용은 다른 서비스 필요)
      const response = await fetch(`http://ip-api.com/json/${ip}`);
      const data = await response.json();
      
      if (data.status === 'success') {
        return {
          ip: data.query,
          country: data.country,
          countryCode: data.countryCode,
          region: data.regionName,
          city: data.city,
          isp: data.isp
        };
      }
      
      return null;
    } catch (error) {
      if (this.config.debugMode) {
        console.error(chalk.red('IP 정보 조회 실패:'), error.message);
      }
      return null;
    }
  }
}

module.exports = IPService;