import chalk from 'chalk';

export class Logger {
  private useColor: boolean;
  
  constructor(
    private verbose: boolean = false, 
    private silent: boolean = false,
    colorMode: 'auto' | 'always' | 'never' = 'auto'
  ) {
    this.useColor = this.shouldUseColor(colorMode);
  }
  
  private shouldUseColor(mode: 'auto' | 'always' | 'never'): boolean {
    if (mode === 'always') return true;
    if (mode === 'never') return false;
    // auto: check if we're in a terminal that supports color
    return process.stdout.isTTY && !process.env.NO_COLOR;
  }
  
  private colorize(fn: typeof chalk.red, text: string): string {
    return this.useColor ? fn(text) : text;
  }
  
  private brand(text: string): string {
    return this.useColor ? chalk.hex('#c99cb3')(text) : text;
  }

  info(message: string): void {
    if (!this.silent) {
      console.log(this.brand('🪷'), message);
    }
  }

  success(message: string): void {
    if (!this.silent) {
      console.log(this.colorize(chalk.green, '✓'), message);
    }
  }

  warning(message: string): void {
    if (!this.silent) {
      console.log(this.colorize(chalk.yellow, '⚠'), message);
    }
  }

  error(message: string): void {
    if (!this.silent) {
      console.log(this.colorize(chalk.red, '✗'), message);
    }
  }

  debug(message: string): void {
    if (this.verbose && !this.silent) {
      console.log(this.brand('🪷'), this.colorize(chalk.gray, message));
    }
  }

  title(message: string): void {
    if (!this.silent) {
      const titleText = this.useColor ? this.brand(chalk.bold('🪷 ' + message)) : '🪷 ' + message;
      console.log('\n' + titleText);
    }
  }

  separator(): void {
    if (!this.silent) {
      console.log(this.brand('─'.repeat(50)));
    }
  }
}