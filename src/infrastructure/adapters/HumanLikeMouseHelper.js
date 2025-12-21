/**
 * Human-Like Mouse Helper
 * 실제 사람처럼 마우스를 움직이고 클릭하는 헬퍼
 */

const chalk = require('chalk');

class HumanLikeMouseHelper {
  constructor(page, config = {}) {
    this.page = page;
    this.config = {
      debugMode: config.debugMode || false,
      mouseMoveSteps: config.mouseMoveSteps || 20, // 마우스 이동 단계
      moveSpeed: config.moveSpeed || 'normal', // slow, normal, fast
      jitterAmount: config.jitterAmount || 3, // 손떨림 정도
      ...config
    };
    
    // 현재 마우스 위치
    this.currentPosition = { x: 0, y: 0 };
    
    // 속도 프리셋
    this.speedPresets = {
      slow: { min: 2000, max: 3000 }, // 느린 이동
      normal: { min: 800, max: 1500 }, // 보통 속도
      fast: { min: 400, max: 800 } // 빠른 이동
    };
  }

  /**
   * 베지어 곡선 계산 (자연스러운 곡선 움직임)
   */
  bezierCurve(t, start, control1, control2, end) {
    const u = 1 - t;
    const tt = t * t;
    const uu = u * u;
    const uuu = uu * u;
    const ttt = tt * t;
    
    const p = {
      x: uuu * start.x + 3 * uu * t * control1.x + 3 * u * tt * control2.x + ttt * end.x,
      y: uuu * start.y + 3 * uu * t * control1.y + 3 * u * tt * control2.y + ttt * end.y
    };
    
    return p;
  }

  /**
   * 랜덤 컨트롤 포인트 생성 (곡선 경로)
   */
  generateControlPoints(start, end) {
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;
    
    // 랜덤하게 곡선 만들기
    const offsetX = (Math.random() - 0.5) * 200;
    const offsetY = (Math.random() - 0.5) * 200;
    
    return {
      control1: {
        x: midX - offsetX * 0.5,
        y: midY - offsetY * 0.5
      },
      control2: {
        x: midX + offsetX * 0.5,
        y: midY + offsetY * 0.5
      }
    };
  }

  /**
   * 실제 사람처럼 마우스 이동
   */
  async moveMouseHumanLike(targetX, targetY) {
    const start = this.currentPosition;
    const end = { x: targetX, y: targetY };
    
    // 거리 계산
    const distance = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));
    
    // 거리에 따른 이동 시간 계산
    const speedPreset = this.speedPresets[this.config.moveSpeed];
    const duration = Math.min(speedPreset.max, Math.max(speedPreset.min, distance * 2));
    
    // 단계 수 계산 (더 많은 단계 = 더 부드러운 움직임)
    const steps = Math.max(20, Math.floor(distance / 5));
    const stepDuration = duration / steps;
    
    // 컨트롤 포인트 생성 (곡선 경로)
    const { control1, control2 } = this.generateControlPoints(start, end);
    
    if (this.config.debugMode) {
      console.log(chalk.gray(`  🖱️ 마우스 이동: (${Math.floor(start.x)}, ${Math.floor(start.y)}) → (${Math.floor(targetX)}, ${Math.floor(targetY)})`));
      console.log(chalk.gray(`     거리: ${Math.floor(distance)}px, 시간: ${duration}ms, 단계: ${steps}`));
    }
    
    // 각 단계별로 마우스 이동
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      
      // 베지어 곡선 상의 점 계산
      const point = this.bezierCurve(t, start, control1, control2, end);
      
      // 손떨림 효과 추가 (마지막 단계 제외)
      if (i < steps && this.config.jitterAmount > 0) {
        point.x += (Math.random() - 0.5) * this.config.jitterAmount;
        point.y += (Math.random() - 0.5) * this.config.jitterAmount;
      }
      
      // 마우스 이동
      await this.page.mouse.move(point.x, point.y);
      
      // 가변적인 대기 시간 (더 자연스럽게)
      const waitTime = stepDuration + (Math.random() - 0.5) * (stepDuration * 0.3);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      
      // 가끔 짧은 정지 (사람이 목표 찾는 것처럼)
      if (Math.random() < 0.05 && i < steps - 5) {
        await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));
      }
    }
    
    // 최종 위치 정확히 설정
    await this.page.mouse.move(targetX, targetY);
    this.currentPosition = { x: targetX, y: targetY };
    
    // 도착 후 미세 조정 (사람처럼)
    if (Math.random() < 0.3) {
      await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));
      const microX = targetX + (Math.random() - 0.5) * 2;
      const microY = targetY + (Math.random() - 0.5) * 2;
      await this.page.mouse.move(microX, microY);
      await new Promise(resolve => setTimeout(resolve, 30 + Math.random() * 50));
      await this.page.mouse.move(targetX, targetY);
    }
  }

  /**
   * 요소의 중심 좌표 가져오기
   */
  async getElementCenter(selector) {
    try {
      const element = await this.page.$(selector);
      if (!element) return null;
      
      const box = await element.boundingBox();
      if (!box) return null;
      
      // 중심에서 약간 랜덤한 위치 (더 자연스럽게)
      const randomOffsetX = (Math.random() - 0.5) * (box.width * 0.3);
      const randomOffsetY = (Math.random() - 0.5) * (box.height * 0.3);
      
      return {
        x: box.x + box.width / 2 + randomOffsetX,
        y: box.y + box.height / 2 + randomOffsetY
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * 텍스트로 요소 찾아서 좌표 가져오기
   */
  async getElementCenterByText(text) {
    try {
      const [element] = await this.page.$x(`//*[contains(text(), "${text}")]`);
      if (!element) return null;
      
      const box = await element.boundingBox();
      if (!box) return null;
      
      const randomOffsetX = (Math.random() - 0.5) * (box.width * 0.3);
      const randomOffsetY = (Math.random() - 0.5) * (box.height * 0.3);
      
      return {
        x: box.x + box.width / 2 + randomOffsetX,
        y: box.y + box.height / 2 + randomOffsetY
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * 사람처럼 클릭하기
   */
  async humanClick(x, y) {
    if (this.config.debugMode) {
      console.log(chalk.cyan(`  🖱️ 클릭: (${Math.floor(x)}, ${Math.floor(y)})`));
    }
    
    // 클릭 전 호버링 (0.1초 ~ 0.3초)
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));
    
    // 클릭 전 미세한 움직임 (긴장감)
    if (Math.random() < 0.2) {
      const nervousX = x + (Math.random() - 0.5) * 2;
      const nervousY = y + (Math.random() - 0.5) * 2;
      await this.page.mouse.move(nervousX, nervousY);
      await new Promise(resolve => setTimeout(resolve, 30 + Math.random() * 50));
      await this.page.mouse.move(x, y);
    }
    
    // 마우스 다운
    await this.page.mouse.down();
    
    // 클릭 유지 시간 (사람마다 다름)
    const holdTime = 50 + Math.random() * 100;
    await new Promise(resolve => setTimeout(resolve, holdTime));
    
    // 마우스 업
    await this.page.mouse.up();
    
    // 클릭 후 짧은 대기
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));
  }

  /**
   * 선택자로 요소 클릭 (마우스 이동 + 클릭)
   */
  async clickElement(selector) {
    const coords = await this.getElementCenter(selector);
    if (!coords) {
      if (this.config.debugMode) {
        console.log(chalk.red(`  ❌ 요소를 찾을 수 없음: ${selector}`));
      }
      return false;
    }
    
    await this.moveMouseHumanLike(coords.x, coords.y);
    await this.humanClick(coords.x, coords.y);
    return true;
  }

  /**
   * 텍스트로 요소 클릭
   */
  async clickByText(text) {
    const coords = await this.getElementCenterByText(text);
    if (!coords) {
      if (this.config.debugMode) {
        console.log(chalk.red(`  ❌ 텍스트를 찾을 수 없음: "${text}"`));
      }
      return false;
    }
    
    await this.moveMouseHumanLike(coords.x, coords.y);
    await this.humanClick(coords.x, coords.y);
    return true;
  }

  /**
   * 입력 필드 클릭 후 타이핑
   */
  async clickAndType(selector, text) {
    // 입력 필드 클릭
    const clicked = await this.clickElement(selector);
    if (!clicked) return false;
    
    // 클릭 후 대기 (포커스 확인)
    await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 200));
    
    // 기존 텍스트 선택 (Ctrl+A)
    await this.page.keyboard.down('Control');
    await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 50));
    await this.page.keyboard.press('a');
    await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 50));
    await this.page.keyboard.up('Control');
    
    // 삭제
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 100));
    await this.page.keyboard.press('Backspace');
    
    // 타이핑 시작 전 대기
    await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300));
    
    // 한 글자씩 타이핑 (사람처럼)
    for (const char of text) {
      await this.page.keyboard.type(char);
      
      // 타이핑 속도 (개인차 반영)
      const typingDelay = 50 + Math.random() * 150;
      await new Promise(resolve => setTimeout(resolve, typingDelay));
      
      // 가끔 짧은 정지 (생각하는 것처럼)
      if (Math.random() < 0.05) {
        await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 500));
      }
    }
    
    return true;
  }

  /**
   * 더블 클릭
   */
  async doubleClick(x, y) {
    await this.humanClick(x, y);
    await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));
    await this.humanClick(x, y);
  }

  /**
   * 마우스 휠 스크롤
   */
  async scrollWheel(direction = 'down', amount = 100) {
    const scrollAmount = direction === 'down' ? amount : -amount;
    
    // 여러 단계로 나누어 스크롤 (더 자연스럽게)
    const steps = 3 + Math.floor(Math.random() * 3);
    const stepAmount = scrollAmount / steps;
    
    for (let i = 0; i < steps; i++) {
      await this.page.mouse.wheel({ deltaY: stepAmount });
      await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));
    }
  }

  /**
   * 현재 마우스 위치 초기화 (화면 중앙)
   */
  async initializeMousePosition() {
    const viewport = await this.page.viewport();
    if (viewport) {
      this.currentPosition = {
        x: viewport.width / 2,
        y: viewport.height / 2
      };
      await this.page.mouse.move(this.currentPosition.x, this.currentPosition.y);
    }
  }
}

module.exports = HumanLikeMouseHelper;