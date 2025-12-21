#!/usr/bin/env node

/**
 * 스케줄 관리 CLI
 * 예약된 작업을 조회하고 취소할 수 있는 간단한 인터페이스
 */

const chalk = require('chalk');
const { setupContainer } = require('./src/container');
const inquirer = require('inquirer');

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  // DI 컨테이너 초기화
  const container = setupContainer();
  const schedulerService = container.resolve('schedulerService');

  switch(command) {
    case '--list':
    case '-l':
      await listScheduledTasks(schedulerService);
      break;
    
    case '--cancel':
    case '-c':
      await cancelScheduledTask(schedulerService);
      break;
    
    case '--cancel-all':
    case '-ca':
      await cancelAllTasks(schedulerService);
      break;
    
    case '--help':
    case '-h':
    default:
      showHelp();
      break;
  }
}

/**
 * 예약된 작업 목록 표시
 */
async function listScheduledTasks(schedulerService) {
  const tasks = schedulerService.getScheduledTasks();
  
  if (tasks.length === 0) {
    console.log(chalk.yellow('\n예약된 작업이 없습니다.\n'));
    return;
  }

  console.log(chalk.cyan('\n📅 예약된 작업 목록:\n'));
  
  tasks.forEach((task, index) => {
    console.log(chalk.blue(`${index + 1}. 작업 ID: ${task.id}`));
    console.log(chalk.gray(`   예약 시간: ${task.scheduledTime.toLocaleString('ko-KR')}`));
    console.log(chalk.gray(`   상태: ${task.status}`));
    
    const remainingTime = schedulerService.getRemainingTime(task.scheduledTime);
    console.log(chalk.gray(`   남은 시간: ${remainingTime}`));
    
    if (task.options && task.options.tasks) {
      console.log(chalk.gray(`   대상 계정 수: ${task.options.tasks.length}개`));
    }
    console.log();
  });
}

/**
 * 특정 작업 취소
 */
async function cancelScheduledTask(schedulerService) {
  const tasks = schedulerService.getScheduledTasks();
  
  if (tasks.length === 0) {
    console.log(chalk.yellow('\n취소할 예약 작업이 없습니다.\n'));
    return;
  }

  const choices = tasks.map((task, index) => ({
    name: `${task.id} - ${task.scheduledTime.toLocaleString('ko-KR')}`,
    value: task.id
  }));

  const { taskId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'taskId',
      message: '취소할 작업을 선택하세요:',
      choices: [...choices, { name: '취소', value: null }]
    }
  ]);

  if (taskId) {
    const success = schedulerService.cancelTask(taskId);
    if (success) {
      console.log(chalk.green(`\n✅ 작업 ${taskId}이(가) 취소되었습니다.\n`));
    } else {
      console.log(chalk.red(`\n❌ 작업 ${taskId}을(를) 취소할 수 없습니다.\n`));
    }
  }
}

/**
 * 모든 작업 취소
 */
async function cancelAllTasks(schedulerService) {
  const tasks = schedulerService.getScheduledTasks();
  
  if (tasks.length === 0) {
    console.log(chalk.yellow('\n취소할 예약 작업이 없습니다.\n'));
    return;
  }

  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: `정말로 ${tasks.length}개의 예약 작업을 모두 취소하시겠습니까?`,
      default: false
    }
  ]);

  if (confirm) {
    const count = schedulerService.cancelAllTasks();
    console.log(chalk.green(`\n✅ ${count}개의 예약 작업이 모두 취소되었습니다.\n`));
  }
}

/**
 * 도움말 표시
 */
function showHelp() {
  console.log(chalk.cyan('\n스케줄 관리자 - YouTube Premium 자동화\n'));
  console.log('사용법: npm run schedule:[command]\n');
  console.log('명령어:');
  console.log('  npm run schedule:list     예약된 작업 목록 보기');
  console.log('  npm run schedule:cancel   특정 예약 작업 취소');
  console.log();
  console.log('또는 직접 실행:');
  console.log('  node schedule-manager.js --list');
  console.log('  node schedule-manager.js --cancel');
  console.log('  node schedule-manager.js --cancel-all');
  console.log('  node schedule-manager.js --help');
  console.log();
}

// 에러 핸들링
process.on('unhandledRejection', (error) => {
  console.error(chalk.red('\n오류 발생:'), error.message);
  process.exit(1);
});

// 메인 함수 실행
main().catch(error => {
  console.error(chalk.red('\n실행 중 오류:'), error.message);
  process.exit(1);
});