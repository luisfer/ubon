import chalk from './colors';

export class Logger {
  private useColor: boolean;
  
  /**
   * `quiet` is a softer form of `silent`: it suppresses chatty progress
   * (info/success/title/separator/debug) but still allows warnings & errors
   * to surface. Used by --quiet for CI runs that want JSON-friendly output
   * without noisy prefixes.
   */
  constructor(
    private verbose: boolean = false,
    private silent: boolean = false,
    colorMode: 'auto' | 'always' | 'never' = 'auto',
    private quiet: boolean = false
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
    if (!this.silent && !this.quiet) {
      console.log(this.brand('🪷'), message);
    }
  }

  success(message: string): void {
    if (!this.silent && !this.quiet) {
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
    if (this.verbose && !this.silent && !this.quiet) {
      console.log(this.brand('🪷'), this.colorize(chalk.gray, message));
    }
  }

  title(message: string): void {
    if (!this.silent && !this.quiet) {
      const titleText = this.useColor ? this.brand(chalk.bold('🪷 ' + message)) : '🪷 ' + message;
      console.log('\n' + titleText);
    }
  }

  separator(): void {
    if (!this.silent && !this.quiet) {
      console.log(this.brand('─'.repeat(50)));
    }
  }
}