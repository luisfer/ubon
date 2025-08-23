import chalk from 'chalk';

export class Logger {
  constructor(private verbose: boolean = false, private silent: boolean = false) {}

  info(message: string): void {
    if (!this.silent) {
      const brand = chalk.hex('#c99cb3');
      console.log(brand('🪷'), message);
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
      const brand = chalk.hex('#c99cb3');
      console.log(brand('🪷'), chalk.gray(message));
    }
  }

  title(message: string): void {
    if (!this.silent) {
      const brand = chalk.hex('#c99cb3');
      console.log('\n' + brand.bold('🪷 ' + message));
    }
  }

  separator(): void {
    if (!this.silent) {
      const brand = chalk.hex('#c99cb3');
      console.log(brand('─'.repeat(50)));
    }
  }
}