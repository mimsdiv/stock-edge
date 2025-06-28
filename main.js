import puppeteer from "puppeteer";
import csv from "csvtojson";
import axios from "axios";

const CONFIG = {
    pageUrl: "https://web.stockedge.com/app/markets",
    wpApiUrl: "https://profitbooking.in/wp-json/scraper/v1/stockedge-feeddata",
    inputFile: "stocks.csv",
}

const fetchandSaveData = async (page, stock) => {
    try {
        // navigate to search input
        await page.type('input.searchbar-input', stock.symbol, { delay: 100 });

        // wait for the search results to load
        await page.waitForSelector('.search-result-list-web ion-item[button]', { timeout: 5000 });

        // click on the first stock result
        const items = await page.$$('.search-result-list-web ion-item[button]');
        for (const item of items) {
            const chip = await item.$('ion-chip');
            if (chip) {
                const chipText = await page.evaluate(el => el.textContent.trim(), chip);
                if (chipText === 'Stock') {
                    await item.click();
                    break;
                }
            }
            else {
                console.log(`No matching stock found for ${stock.symbol}`);
                await page.click('input.searchbar-input', { clickCount: 3 }); // Select all text
                await page.keyboard.press('Backspace'); // Clear the input
                return;
            }
        }

        await new Promise(resolve => setTimeout(resolve, 3000));

        // navigate to feeds section
        // await page.waitForSelector('.tab-scroll-container', { timeout: 5000 }); // wait for the stock details to load
        // await page.click('div.tab-scroll-container > div:nth-child(4)'); // Click on the "Updates" tab
        // await page.waitForSelector('.subtab-container', { timeout: 2000 });
        // await page.click('div.subtab-container > div:nth-child(4)'); // Click on the "Feeds" tab
        // await page.waitForSelector('ion-content ion-list', { timeout: 1000 });

        // navigate to feeds section by modifying the URL
        const currentUrl = page.url() + '?';
        const newUrl = currentUrl.substring(0, currentUrl.indexOf('?')) + '?section=feeds';
        await page.goto(newUrl, { waitUntil: 'networkidle2' });

        // load each feed item
        await page.waitForSelector('ion-content ion-list ion-item', { timeout: 3000 });
        const feedItems = await page.$$('ion-content ion-list ion-item');

        for (const item of feedItems) {
            const sourceElement = await item.$('ion-grid > ion-row:nth-child(1) > ion-col:nth-child(1)');
            const dateElement = await item.$('ion-grid > ion-row:nth-child(1) > ion-col:nth-child(2)');
            const contentElement = await item.$('ion-grid > ion-row:nth-child(2) > ion-col > p');

            const source = sourceElement ? await page.evaluate(el => el.textContent.trim(), sourceElement) : '';
            const date = dateElement ? await page.evaluate(el => el.textContent.trim(), dateElement) : '';
            const content = contentElement ? await page.evaluate(el => el.textContent.trim(), contentElement) : '';

            if (source && content) {
                const stockData = {
                    stock: stock.symbol,
                    stockName: stock.name,
                    date: new Date(date).toISOString(), // Convert to ISO format
                    source: source,
                    content: content,
                };
                // console.log(`Saving data for ${stock.symbol}:`, stockData);

                await saveDatatoWordPress(stockData);
            }

            if (new Date() - new Date(date) > 24 * 60 * 60 * 1000) {
                // If the date is more than 24 hours old, skip further processing
                // console.log(`Skipping old feed item for ${stock.symbol} dated ${date}`);
                break;
            }
        }
    }
    catch (error) {
        const text = await page.$eval('input.searchbar-input', el => el.value);
        console.error(`Error fetching data for ${text}:`, error.message);
        await page.click('input.searchbar-input', { clickCount: 3 }); // Select all text
        await page.keyboard.press('Backspace'); // Clear the input
    }
}

const saveDatatoWordPress = async (data) => {
    try {
        const response = await axios.post(CONFIG.wpApiUrl, data, {
            headers: {
                // 'Authorization': `Bearer ${process.env.WP_API_TOKEN}`,
                'Content-Type': 'application/json',
            }
        });

        // console.log('Data saved to WordPress');
    } catch (error) {
        console.error('WP API Error:', error.response?.data || error.message);
    }
}

const main = async () => {
    try {
        // Read the CSV file
        const jsonArray = await csv().fromFile(CONFIG.inputFile);
        const stocks = jsonArray.map(item => ({ name: item['Stock name'], symbol: item['Symbol'] }));

        const start = parseInt(process.argv[2]) || 0; // Start index from command line argument
        const end = parseInt(process.argv[3]) || stocks.length; // End index from command line argument

        // Launch Puppeteer
        const browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-gpu',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-popup-blocking',
                '--disable-notifications',
                '--disable-blink-features=AutomationControlled', // Important
                '--window-size=1920,1080',
            ],
        });

        const page = await browser.newPage();

        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
        );

        await page.setExtraHTTPHeaders({
            'accept-language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
        });

        await page.goto(CONFIG.pageUrl, { waitUntil: 'networkidle2' });

        // Scrape data for each stock code
        for (const stock of stocks.slice(start, end)) {
            console.log(`Processing stock code: ${stock.symbol}`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            await fetchandSaveData(page, stock);
        }
        await fetchandSaveData(page, stocks[0]);

        await browser.close();
    }
    catch (error) {
        console.error("An error occurred:", error);
    }
}

main();
