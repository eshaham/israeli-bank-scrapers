"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
Object.defineProperty(exports, "CompanyTypes", {
  enumerable: true,
  get: function () {
    return _definitions.CompanyTypes;
  }
});
Object.defineProperty(exports, "OneZeroScraper", {
  enumerable: true,
  get: function () {
    return _oneZero.default;
  }
});
Object.defineProperty(exports, "SCRAPERS", {
  enumerable: true,
  get: function () {
    return _definitions.SCRAPERS;
  }
});
Object.defineProperty(exports, "ScaperLoginResult", {
  enumerable: true,
  get: function () {
    return _interface.ScraperLoginResult;
  }
});
Object.defineProperty(exports, "ScaperScrapingResult", {
  enumerable: true,
  get: function () {
    return _interface.ScraperScrapingResult;
  }
});
Object.defineProperty(exports, "Scraper", {
  enumerable: true,
  get: function () {
    return _interface.Scraper;
  }
});
Object.defineProperty(exports, "ScraperCredentials", {
  enumerable: true,
  get: function () {
    return _interface.ScraperCredentials;
  }
});
Object.defineProperty(exports, "ScraperLoginResult", {
  enumerable: true,
  get: function () {
    return _interface.ScraperLoginResult;
  }
});
Object.defineProperty(exports, "ScraperOptions", {
  enumerable: true,
  get: function () {
    return _interface.ScraperOptions;
  }
});
Object.defineProperty(exports, "ScraperScrapingResult", {
  enumerable: true,
  get: function () {
    return _interface.ScraperScrapingResult;
  }
});
Object.defineProperty(exports, "createScraper", {
  enumerable: true,
  get: function () {
    return _factory.default;
  }
});
exports.getPuppeteerConfig = getPuppeteerConfig;
var _definitions = require("./definitions");
var _factory = _interopRequireDefault(require("./scrapers/factory"));
var _interface = require("./scrapers/interface");
var _oneZero = _interopRequireDefault(require("./scrapers/one-zero"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Note: the typo ScaperScrapingResult & ScraperLoginResult (sic) are exported here for backward compatibility

function getPuppeteerConfig() {
  return {
    chromiumRevision: '1250580'
  }; // https://github.com/puppeteer/puppeteer/releases/tag/puppeteer-core-v22.5.0
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfZGVmaW5pdGlvbnMiLCJyZXF1aXJlIiwiX2ZhY3RvcnkiLCJfaW50ZXJvcFJlcXVpcmVEZWZhdWx0IiwiX2ludGVyZmFjZSIsIl9vbmVaZXJvIiwiZSIsIl9fZXNNb2R1bGUiLCJkZWZhdWx0IiwiZ2V0UHVwcGV0ZWVyQ29uZmlnIiwiY2hyb21pdW1SZXZpc2lvbiJdLCJzb3VyY2VzIjpbIi4uL3NyYy9pbmRleC50cyJdLCJzb3VyY2VzQ29udGVudCI6WyJleHBvcnQgeyBDb21wYW55VHlwZXMsIFNDUkFQRVJTIH0gZnJvbSAnLi9kZWZpbml0aW9ucyc7XG5leHBvcnQgeyBkZWZhdWx0IGFzIGNyZWF0ZVNjcmFwZXIgfSBmcm9tICcuL3NjcmFwZXJzL2ZhY3RvcnknO1xuXG4vLyBOb3RlOiB0aGUgdHlwbyBTY2FwZXJTY3JhcGluZ1Jlc3VsdCAmIFNjcmFwZXJMb2dpblJlc3VsdCAoc2ljKSBhcmUgZXhwb3J0ZWQgaGVyZSBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eVxuZXhwb3J0IHtcbiAgU2NyYXBlckxvZ2luUmVzdWx0IGFzIFNjYXBlckxvZ2luUmVzdWx0LFxuICBTY3JhcGVyU2NyYXBpbmdSZXN1bHQgYXMgU2NhcGVyU2NyYXBpbmdSZXN1bHQsXG4gIFNjcmFwZXIsXG4gIFNjcmFwZXJDcmVkZW50aWFscyxcbiAgU2NyYXBlckxvZ2luUmVzdWx0LFxuICBTY3JhcGVyT3B0aW9ucyxcbiAgU2NyYXBlclNjcmFwaW5nUmVzdWx0LFxufSBmcm9tICcuL3NjcmFwZXJzL2ludGVyZmFjZSc7XG5cbmV4cG9ydCB7IGRlZmF1bHQgYXMgT25lWmVyb1NjcmFwZXIgfSBmcm9tICcuL3NjcmFwZXJzL29uZS16ZXJvJztcblxuZXhwb3J0IGZ1bmN0aW9uIGdldFB1cHBldGVlckNvbmZpZygpIHtcbiAgcmV0dXJuIHsgY2hyb21pdW1SZXZpc2lvbjogJzEyNTA1ODAnIH07IC8vIGh0dHBzOi8vZ2l0aHViLmNvbS9wdXBwZXRlZXIvcHVwcGV0ZWVyL3JlbGVhc2VzL3RhZy9wdXBwZXRlZXItY29yZS12MjIuNS4wXG59XG4iXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLElBQUFBLFlBQUEsR0FBQUMsT0FBQTtBQUNBLElBQUFDLFFBQUEsR0FBQUMsc0JBQUEsQ0FBQUYsT0FBQTtBQUdBLElBQUFHLFVBQUEsR0FBQUgsT0FBQTtBQVVBLElBQUFJLFFBQUEsR0FBQUYsc0JBQUEsQ0FBQUYsT0FBQTtBQUFnRSxTQUFBRSx1QkFBQUcsQ0FBQSxXQUFBQSxDQUFBLElBQUFBLENBQUEsQ0FBQUMsVUFBQSxHQUFBRCxDQUFBLEtBQUFFLE9BQUEsRUFBQUYsQ0FBQTtBQVhoRTs7QUFhTyxTQUFTRyxrQkFBa0JBLENBQUEsRUFBRztFQUNuQyxPQUFPO0lBQUVDLGdCQUFnQixFQUFFO0VBQVUsQ0FBQyxDQUFDLENBQUM7QUFDMUMiLCJpZ25vcmVMaXN0IjpbXX0=