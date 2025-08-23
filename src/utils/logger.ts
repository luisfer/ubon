import chalk from 'chalk';

export class Logger {
  constructor(private verbose: boolean = false, private silent: boolean = false) {}

  info(message: string): void {
    if (!this.silent) {
      console.log(chalk.blue('ℹ'), message);
    }
  }

  success(message: string): void {
    if (!this.silent) {
      console.log(chalk.green('✓'), message);
    }
  }

  warning(message: string): void {
    if (!this.silent) {
      console.log(chalk.yellow('⚠'), message);
    }
  }

  error(message: string): void {
    if (!this.silent) {
      console.log(chalk.red('✗'), message);
    }
  }

  debug(message: string): void {
    if (this.verbose && !this.silent) {
      console.log(chalk.gray('🔍'), message);
    }
  }

  title(message: string): void {
    if (!this.silent) {
      console.log('\n' + chalk.bold.cyan('🔍 ' + message));
    }
  }

  separator(): void {
    if (!this.silent) {
      console.log(chalk.gray('─'.repeat(50)));
    }
  }
}