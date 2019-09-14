 The table below show the list of companies that support each scraper type:


## Building your own scraper
TODO should provide more details and review the example code.

```
import userLogin from 'src/scrapers/leumi/login';
import { getBrowser, getBrowserPage } from 'src/helpers/scraping';
import scrapeSummary from 'src/scrapers/leumi/scrape-summary';

(async function scrape() {
    const credentials = {}; // TODO provide relevant scraper credentials
    try {
      const browser = await getBrowser({
        verbose: true, // optional
        showBrowser: true, // optional
      });
      const page = await getBrowserPage(browser);

      const userLoginResult = await userLogin(page, {
        credentials,
      });

      if (!userLoginResult.success) {
        console.error(userLoginResult.error);
        return;
      }
      await scrapeSummary(page);
    } catch (e) {
      console.error(e);
      throw e;
    }
  }
}());
```
