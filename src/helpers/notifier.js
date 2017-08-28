class ScraperNotifier {
  constructor(scraperName) {
    this.scraperName = scraperName;
  }

  notify(options, message) {
    if (options.eventsCallback) {
      options.eventsCallback(`${this.scraperName}: ${message}`);
    }
  }
}

export default ScraperNotifier;
