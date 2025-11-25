import puppeteer from "puppeteer";
import csv from "csvtojson";
import axios from "axios";

const CONFIG = {
    pageUrl: "https://web.stockedge.com/app/markets",
    wpApiUrl: "https://profitbooking.in/wp-json/scraper/v1/stockedge-feeddata",
    inputFile: "stocks.csv",
    wpApiToken: process.env.WP_API_TOKEN || '', // Use environment variable for token
};

const delay = ms => new Promise(res => setTimeout(res, ms));

const fetchandSaveData = async (page, stock) => {
    try {
        await page.waitForSelector('input.searchbar-input', { timeout: 5000 });
        await page.click('input.searchbar-input', { clickCount: 3 });
        await page.keyboard.press('Backspace');
        await delay(500);

        await page.type('input.searchbar-input', stock.symbol, { delay: 100 });

        await page.waitForSelector('.search-result-list-web ion-item[button]', { timeout: 7000 });
        const items = await page.$$('.search-result-list-web ion-item[button]');
        let clicked = false;
        for (const item of items) {
            const chip = await item.$('ion-chip');
            if (chip) {
                const chipText = await page.evaluate(el => el.textContent.trim(), chip);
                if (chipText === 'Stock') {
                    await item.click();
                    clicked = true;
                    break;
                }
            }
        }

        if (!clicked) {
            console.log(`No matching stock found for ${stock.symbol}`);
            return;
        }

        await delay(3000);

        const currentUrl = page.url();
        const newUrl = currentUrl.split('?')[0] + '?section=feeds';
        await page.goto(newUrl, { waitUntil: 'networkidle2' });

        await page.waitForSelector('se-option-btns', { timeout: 5000 });
        await page.click('se-option-btns'); // Open filter
        await page.waitForSelector('app-feeds-filter ion-radio-group > div > ion-item:nth-child(2)', { timeout: 5000 });
        await page.click('app-feeds-filter ion-radio-group > div > ion-item:nth-child(2)');
        await delay(2000);

        await page.waitForSelector('ion-content ion-list ion-item', { timeout: 5000 });
        const feedItems = await page.$$('ion-content ion-list ion-item');

        for (const item of feedItems) {
            const dateElement = await item.$('ion-grid > ion-row:nth-child(1) > ion-col:nth-child(2)');
            const dateText = dateElement ? await page.evaluate(el => el.textContent.trim(), dateElement) : '';

            const postDate = new Date(dateText);
            if (isNaN(postDate)) {
                continue;
            }

            if ((Date.now() - postDate.getTime()) > 24 * 60 * 60 * 1000) {
                break;
            }

            const sourceElement = await item.$('ion-grid > ion-row:nth-child(1) > ion-col:nth-child(1)');
            const contentElement = await item.$('ion-grid > ion-row:nth-child(2) > ion-col > p');

            const source = sourceElement ? await page.evaluate(el => el.textContent.trim(), sourceElement) : '';
            const content = contentElement ? await page.evaluate(el => el.textContent.trim(), contentElement) : '';

            if (source && content) {
                const stockData = {
                    stock: stock.symbol,
                    stockName: stock.name,
                    date: postDate.toISOString(),
                    source: source,
                    content: content,
                };

                await saveDatatoWordPress(stockData);
                await delay(500); // Delay between API posts
            }
        }
    } catch (error) {
        const currentInputValue = await page.$eval('input.searchbar-input', el => el.value).catch(() => '');
        console.error(`Error fetching data for ${currentInputValue || stock.symbol}:`, error.message || error);
        try {
            await page.click('input.searchbar-input', { clickCount: 3 });
            await page.keyboard.press('Backspace');
        } catch {}
    }
}

const saveDatatoWordPress = async (data) => {
    try {
        const headers = {
            'Content-Type': 'application/json',
        };
        if(CONFIG.wpApiToken){
            headers['Authorization'] = `Bearer ${CONFIG.wpApiToken}`;
        }
        const response = await axios.post(CONFIG.wpApiUrl, data, { headers });
        console.log(`Data saved for ${data.stock}: Status ${response.status}`);
    } catch (error) {
        if (error.response) {
            console.error('WP API Error:', error.response.status, error.response.data);
        } else {
            console.error('WP API Error:', error.message);
        }
    }
}

const main = async () => {
    try {
        const jsonArray = await csv().fromFile(CONFIG.inputFile);
        const stocks = jsonArray.map(item => ({ name: item['Stock name'], symbol: item['Symbol'] }));

        const start = parseInt(process.argv[2]) || 0;
        const end = parseInt(process.argv[3]) || stocks.length;

        const browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-gpu',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-popup-blocking',
                '--disable-notifications',
                '--disable-blink-features=AutomationControlled',
                '--window-size=1920,1080',
            ],
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({
            'accept-language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
        });

        await page.goto(CONFIG.pageUrl, { waitUntil: 'networkidle2' });

        for (const stock of stocks.slice(start, end)) {
            console.log(`Processing stock code: ${stock.symbol}`);
            await delay(2000);
            await fetchandSaveData(page, stock);
        }

        await browser.close();
    } catch (error) {
        console.error("An error occurred:", error);
    }
}

main();
