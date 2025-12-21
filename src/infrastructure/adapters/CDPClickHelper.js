/**
 * CDP(Chrome DevTools Protocol) 클릭 헬퍼
 * Google의 자동화 탐지를 우회하는 네이티브 입력 처리
 * 
 * @author AdsPower Automation Team
 * @version 1.0.0
 */

const chalk = require('chalk');

class CDPClickHelper {
    constructor(page, options = {}) {
        this.page = page;
        this.client = null;
        this.options = {
            verbose: options.verbose || false,
            naturalDelay: options.naturalDelay !== false, // 자연스러운 지연 추가
            ...options
        };
    }

    /**
     * CDP 세션 초기화
     */
    async initialize() {
        if (!this.client) {
            this.client = await this.page.target().createCDPSession();
            if (this.options.verbose) {
                console.log(chalk.gray('  CDP 세션 초기화 완료'));
            }
        }
        return this.client;
    }

    /**
     * CDP를 통한 네이티브 클릭
     * @param {string} selector - CSS 선택자
     * @param {Object} options - 클릭 옵션
     * @returns {boolean} 성공 여부
     */
    async click(selector, options = {}) {
        try {
            // CDP 세션 확인
            await this.initialize();

            // 요소 찾기
            const element = await this.page.$(selector);
            if (!element) {
                if (this.options.verbose) {
                    console.log(chalk.yellow(`  요소를 찾을 수 없음: ${selector}`));
                }
                return false;
            }

            // 요소 위치 계산
            const box = await element.boundingBox();
            if (!box) {
                if (this.options.verbose) {
                    console.log(chalk.yellow(`  요소가 화면에 표시되지 않음: ${selector}`));
                }
                return false;
            }

            // 클릭 위치 계산 (요소 중앙)
            const x = box.x + box.width / 2;
            const y = box.y + box.height / 2;

            if (this.options.verbose) {
                console.log(chalk.gray(`  CDP 클릭 위치: (${Math.round(x)}, ${Math.round(y)})`));
            }

            // 1. 마우스 이동 (호버 효과)
            await this.client.send('Input.dispatchMouseEvent', {
                type: 'mouseMoved',
                x: x,
                y: y
            });

            // 자연스러운 호버 지연
            if (this.options.naturalDelay) {
                await new Promise(r => setTimeout(r, 300 + Math.random() * 200));
            }

            // 2. 마우스 버튼 누르기
            await this.client.send('Input.dispatchMouseEvent', {
                type: 'mousePressed',
                x: x,
                y: y,
                button: 'left',
                clickCount: 1,
                buttons: 1
            });

            // 클릭 유지 시간 (사람처럼)
            if (this.options.naturalDelay) {
                await new Promise(r => setTimeout(r, 50 + Math.random() * 50));
            }

            // 3. 마우스 버튼 떼기
            await this.client.send('Input.dispatchMouseEvent', {
                type: 'mouseReleased',
                x: x,
                y: y,
                button: 'left',
                clickCount: 1,
                buttons: 0
            });

            if (this.options.verbose) {
                console.log(chalk.green(`  ✓ CDP 클릭 완료: ${selector}`));
            }

            return true;

        } catch (error) {
            if (this.options.verbose) {
                console.log(chalk.red(`  CDP 클릭 오류: ${error.message}`));
            }
            return false;
        }
    }

    /**
     * CDP를 통한 텍스트 입력
     * @param {string} selector - CSS 선택자
     * @param {string} text - 입력할 텍스트
     * @param {Object} options - 입력 옵션
     */
    async type(selector, text, options = {}) {
        try {
            await this.initialize();

            // 먼저 클릭하여 포커스
            await this.click(selector);
            await new Promise(r => setTimeout(r, 200));

            // 기존 텍스트 선택 (Ctrl+A)
            if (options.clear) {
                await this.client.send('Input.dispatchKeyEvent', {
                    type: 'keyDown',
                    modifiers: 2, // Ctrl
                    windowsVirtualKeyCode: 65, // A
                    key: 'a'
                });
                await this.client.send('Input.dispatchKeyEvent', {
                    type: 'keyUp',
                    modifiers: 2,
                    windowsVirtualKeyCode: 65,
                    key: 'a'
                });
                await new Promise(r => setTimeout(r, 100));
            }

            // 텍스트 입력 (각 문자마다)
            for (const char of text) {
                await this.client.send('Input.insertText', {
                    text: char
                });
                
                if (this.options.naturalDelay) {
                    await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
                }
            }

            if (this.options.verbose) {
                console.log(chalk.green(`  ✓ CDP 텍스트 입력 완료`));
            }

            return true;

        } catch (error) {
            if (this.options.verbose) {
                console.log(chalk.red(`  CDP 입력 오류: ${error.message}`));
            }
            return false;
        }
    }

    /**
     * CDP를 통한 키 입력
     * @param {string} key - 키 이름 (Enter, Tab, Escape 등)
     */
    async pressKey(key) {
        try {
            await this.initialize();

            const keyMap = {
                'Enter': { code: 13, key: 'Enter' },
                'Tab': { code: 9, key: 'Tab' },
                'Escape': { code: 27, key: 'Escape' },
                'Space': { code: 32, key: ' ' },
                'ArrowDown': { code: 40, key: 'ArrowDown' },
                'ArrowUp': { code: 38, key: 'ArrowUp' }
            };

            const keyInfo = keyMap[key];
            if (!keyInfo) {
                throw new Error(`지원하지 않는 키: ${key}`);
            }

            // 키 다운
            await this.client.send('Input.dispatchKeyEvent', {
                type: 'keyDown',
                windowsVirtualKeyCode: keyInfo.code,
                key: keyInfo.key
            });

            await new Promise(r => setTimeout(r, 50));

            // 키 업
            await this.client.send('Input.dispatchKeyEvent', {
                type: 'keyUp',
                windowsVirtualKeyCode: keyInfo.code,
                key: keyInfo.key
            });

            if (this.options.verbose) {
                console.log(chalk.green(`  ✓ CDP 키 입력: ${key}`));
            }

            return true;

        } catch (error) {
            if (this.options.verbose) {
                console.log(chalk.red(`  CDP 키 입력 오류: ${error.message}`));
            }
            return false;
        }
    }

    /**
     * CDP를 통한 더블클릭
     */
    async doubleClick(selector) {
        try {
            await this.initialize();

            const element = await this.page.$(selector);
            if (!element) return false;

            const box = await element.boundingBox();
            if (!box) return false;

            const x = box.x + box.width / 2;
            const y = box.y + box.height / 2;

            // 더블클릭 시퀀스
            for (let i = 0; i < 2; i++) {
                await this.client.send('Input.dispatchMouseEvent', {
                    type: 'mousePressed',
                    x: x,
                    y: y,
                    button: 'left',
                    clickCount: i + 1
                });
                
                await new Promise(r => setTimeout(r, 50));
                
                await this.client.send('Input.dispatchMouseEvent', {
                    type: 'mouseReleased',
                    x: x,
                    y: y,
                    button: 'left',
                    clickCount: i + 1
                });
                
                if (i === 0) {
                    await new Promise(r => setTimeout(r, 100)); // 더블클릭 간격
                }
            }

            return true;

        } catch (error) {
            if (this.options.verbose) {
                console.log(chalk.red(`  CDP 더블클릭 오류: ${error.message}`));
            }
            return false;
        }
    }

    /**
     * CDP를 통한 우클릭
     */
    async rightClick(selector) {
        try {
            await this.initialize();

            const element = await this.page.$(selector);
            if (!element) return false;

            const box = await element.boundingBox();
            if (!box) return false;

            const x = box.x + box.width / 2;
            const y = box.y + box.height / 2;

            await this.client.send('Input.dispatchMouseEvent', {
                type: 'mousePressed',
                x: x,
                y: y,
                button: 'right',
                clickCount: 1
            });

            await new Promise(r => setTimeout(r, 50));

            await this.client.send('Input.dispatchMouseEvent', {
                type: 'mouseReleased',
                x: x,
                y: y,
                button: 'right',
                clickCount: 1
            });

            return true;

        } catch (error) {
            if (this.options.verbose) {
                console.log(chalk.red(`  CDP 우클릭 오류: ${error.message}`));
            }
            return false;
        }
    }

    /**
     * CDP를 통한 호버
     */
    async hover(selector) {
        try {
            await this.initialize();

            const element = await this.page.$(selector);
            if (!element) return false;

            const box = await element.boundingBox();
            if (!box) return false;

            const x = box.x + box.width / 2;
            const y = box.y + box.height / 2;

            await this.client.send('Input.dispatchMouseEvent', {
                type: 'mouseMoved',
                x: x,
                y: y
            });

            return true;

        } catch (error) {
            if (this.options.verbose) {
                console.log(chalk.red(`  CDP 호버 오류: ${error.message}`));
            }
            return false;
        }
    }

    /**
     * 텍스트 기반 요소 클릭 (CDP)
     * @param {Array<string>} textArray - 찾을 텍스트 배열
     * @param {Object} options - 클릭 옵션
     */
    async clickByText(textArray, options = {}) {
        try {
            await this.initialize();

            // 페이지에서 텍스트 포함 요소 찾기
            const found = await this.page.evaluate((searchTexts) => {
                const allElements = document.querySelectorAll('div, li, button, a, span');
                
                for (const element of allElements) {
                    const text = element.textContent?.trim();
                    if (!text) continue;
                    
                    for (const searchText of searchTexts) {
                        if (text.includes(searchText) || text === searchText) {
                            const rect = element.getBoundingClientRect();
                            const isVisible = rect.width > 0 && rect.height > 0 && 
                                             element.offsetParent !== null;
                            
                            if (isVisible) {
                                return {
                                    found: true,
                                    x: rect.left + rect.width / 2,
                                    y: rect.top + rect.height / 2,
                                    text: searchText
                                };
                            }
                        }
                    }
                }
                
                return { found: false };
            }, textArray);

            if (found.found) {
                // CDP 네이티브 클릭
                await this.client.send('Input.dispatchMouseEvent', {
                    type: 'mouseMoved',
                    x: found.x,
                    y: found.y
                });

                if (this.options.naturalDelay) {
                    await new Promise(r => setTimeout(r, 200 + Math.random() * 100));
                }

                await this.client.send('Input.dispatchMouseEvent', {
                    type: 'mousePressed',
                    x: found.x,
                    y: found.y,
                    button: 'left',
                    clickCount: 1
                });

                await new Promise(r => setTimeout(r, 50));

                await this.client.send('Input.dispatchMouseEvent', {
                    type: 'mouseReleased',
                    x: found.x,
                    y: found.y,
                    button: 'left',
                    clickCount: 1
                });

                if (this.options.verbose) {
                    console.log(chalk.green(`  ✓ CDP 텍스트 클릭 완료: "${found.text}"`));
                }

                return true;
            }

            if (this.options.verbose) {
                console.log(chalk.yellow(`  텍스트를 찾을 수 없음: ${textArray.join(', ')}`));
            }

            return false;

        } catch (error) {
            if (this.options.verbose) {
                console.log(chalk.red(`  CDP 텍스트 클릭 오류: ${error.message}`));
            }
            return false;
        }
    }

    /**
     * 부모 요소 클릭 옵션이 있는 CDP 클릭
     * @param {string} selector - CSS 선택자
     * @param {Object} options - 클릭 옵션 (clickParent: true로 부모 클릭)
     */
    async clickWithOptions(selector, options = {}) {
        try {
            await this.initialize();

            // 요소 정보 가져오기
            const elementInfo = await this.page.evaluate((sel, opts) => {
                let element = document.querySelector(sel);
                if (!element) return null;

                // 부모 요소 클릭 옵션
                if (opts.clickParent) {
                    const parent = element.closest('li') || 
                                 element.closest('div[role="link"]') || 
                                 element.parentElement;
                    if (parent) {
                        element = parent;
                    }
                }

                const rect = element.getBoundingClientRect();
                const isVisible = rect.width > 0 && rect.height > 0 && 
                                 element.offsetParent !== null;

                if (!isVisible) return null;

                return {
                    x: rect.left + rect.width / 2,
                    y: rect.top + rect.height / 2
                };
            }, selector, options);

            if (!elementInfo) {
                if (this.options.verbose) {
                    console.log(chalk.yellow(`  요소를 찾을 수 없음: ${selector}`));
                }
                return false;
            }

            // CDP 네이티브 클릭 실행
            await this.client.send('Input.dispatchMouseEvent', {
                type: 'mouseMoved',
                x: elementInfo.x,
                y: elementInfo.y
            });

            if (this.options.naturalDelay) {
                await new Promise(r => setTimeout(r, 200 + Math.random() * 100));
            }

            await this.client.send('Input.dispatchMouseEvent', {
                type: 'mousePressed',
                x: elementInfo.x,
                y: elementInfo.y,
                button: 'left',
                clickCount: 1
            });

            await new Promise(r => setTimeout(r, 50));

            await this.client.send('Input.dispatchMouseEvent', {
                type: 'mouseReleased',
                x: elementInfo.x,
                y: elementInfo.y,
                button: 'left',
                clickCount: 1
            });

            if (this.options.verbose) {
                console.log(chalk.green(`  ✓ CDP 클릭 완료 (옵션 적용): ${selector}`));
            }

            return true;

        } catch (error) {
            if (this.options.verbose) {
                console.log(chalk.red(`  CDP 클릭 오류: ${error.message}`));
            }
            return false;
        }
    }

    /**
     * 세션 정리
     */
    async cleanup() {
        if (this.client) {
            await this.client.detach();
            this.client = null;
        }
    }
}

module.exports = CDPClickHelper;