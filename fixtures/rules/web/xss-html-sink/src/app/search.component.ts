import { Component } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';

@Component({ selector: 'app-search', template: '<p [innerHTML]="searchValue"></p>' })
export class SearchComponent {
  searchValue: SafeHtml = '';

  constructor(
    private readonly sanitizer: DomSanitizer,
    private readonly route: ActivatedRoute,
  ) {}

  ngOnInit() {
    const query = this.route.snapshot.queryParams.q;
    this.searchValue = this.sanitizer.bypassSecurityTrustHtml(query); // expect-block: web/xss-html-sink
    this.searchValue = this.sanitizer.bypassSecurityTrustHtml('<b>Search</b>'); // ok: constant markup
  }
}
