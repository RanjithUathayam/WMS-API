function formatDate(date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear()).slice(-2); // Get last two digits of the year
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${day}-${month}-${year}_${hours}:${minutes}:${seconds}`;
}

const formattedDate = formatDate(new Date());
async function exportData(res, format, filename, columns, data) { 
    try { 
        switch (format) {
            case 'csv':
                await generateCSVData(res, data, filename, columns);
                break;
            case 'excel':
                await generateExcelData(res, data, filename, columns);
                break;
            case 'pdf': 
                await generateHTMLPDFData(res, data, filename, columns);
                break;
            default:
                throw new Error('Invalid export format');
        }
        return filename;
    } catch (error) {
        res.status(202).json({status: 0, message: error.message});
    }
}

// Sample data for testing
const sampleData = [
    { id: 1, name: 'John', age: 30 },
    { id: 2, name: 'Jane', age: 25 },
    { id: 3, name: 'Doe', age: 40 }
];

// Function to generate CSV data
function generateCSVData(res, data, reportName, columns) {
    const { createObjectCsvStringifier } = require('csv-writer');

    const headers = [];
    JSON.parse(columns).forEach(column => {
        headers.push({ id: column.data, title: column.header });
    });

    const csvStringifier = createObjectCsvStringifier({
        header: headers
    });

    // Extract the data from dataValues
    const formattedData = data.map(row => {
        const formattedRow = {};
        JSON.parse(columns).forEach(column => {
            if((reportName == 'Inventory Report') || (reportName == 'Pallet Request Report')|| (reportName == 'Alarm History Report') || (reportName == 'User Report') || (reportName == 'Pre-Binning Report') || (reportName == 'Pallet Mapping Report') || (reportName == 'Location Mapping Report') || (reportName == 'Inventory Details Report'))
            {
                formattedRow[column.data] = row[column.data] !== undefined ? row[column.data] : 'N/A';
            }
            else
            {
                formattedRow[column.data] = row.dataValues[column.data] !== undefined ? row.dataValues[column.data] : 'N/A';
            }
            
        });
        return formattedRow;
    });

    const timestamp = new Date().toLocaleString();
    const reportDetails = `Report Name: ${reportName}\nGenerated at: ${timestamp}\n\n`;

    const csvData = reportDetails + csvStringifier.getHeaderString() + csvStringifier.stringifyRecords(formattedData);

    const filename = reportName.replace(/\s/g, '_') + '-' + formatDate(new Date());

    // Set response headers
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);

    // Send CSV data as response
    res.send(csvData);
}


async function generateExcelData(res, data, reportName, columns) {
    try {
        const XLSX = require('xlsx'); 

        const headers = [];
        const headersData = [];
        const parsedColumns = JSON.parse(columns);
        
        parsedColumns.forEach(column => {
            headers.push(column.header);
        });

        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.aoa_to_sheet([]);

        // Add report details to the first two rows        
        const timestamp = new Date().toLocaleString();
        XLSX.utils.sheet_add_aoa(worksheet, [[`Report`]], { origin: 'A1' });
        XLSX.utils.sheet_add_aoa(worksheet, [[reportName]], { origin: 'B1' });
        XLSX.utils.sheet_add_aoa(worksheet, [[`UserName`]], { origin: 'A2' });
        XLSX.utils.sheet_add_aoa(worksheet, [[`Admin`]], { origin: 'B2' });
        XLSX.utils.sheet_add_aoa(worksheet, [[`Generated at`]], { origin: 'A3' });
        XLSX.utils.sheet_add_aoa(worksheet, [[timestamp]], { origin: 'B3' });

        // Convert JSON data into Excel rows
        const jsonRows = data.map(obj => {
            const row = [];
            parsedColumns.forEach(header => {
                if((reportName == 'Inventory Report') || (reportName == 'Pallet Request Report')|| (reportName == 'Alarm History Report') || (reportName == 'User Report') || (reportName == 'Pre-Binning Report') || (reportName == 'Pallet Mapping Report') || (reportName == 'Location Mapping Report') || (reportName == 'Inventory Details Report'))
                {
                    row.push(obj[header.data] !== undefined ? obj[header.data] : 'N/A'); // Only include columns present in the header
                }
                else
                {
                    row.push(obj.dataValues[header.data] !== undefined ? obj.dataValues[header.data] : 'N/A'); // Only include columns present in the header
                }
            });
            return row;
        });

        XLSX.utils.sheet_add_aoa(worksheet, [headers], { origin: 'A5' });
        // Append JSON data to the worksheet starting from the third row
        XLSX.utils.sheet_add_aoa(worksheet, jsonRows, { origin: 'A6' });

        // Add the worksheet to the workbook
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');

        // Convert workbook to Excel buffer
        const excelBuffer = XLSX.write(workbook, { type: 'buffer' });

        const filename = reportName.replace(/\s/g, '_') + '-' + formatDate(new Date());
        // Set response headers
        res.set({
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="${filename}.xlsx"`
        });

        // Send the Excel buffer as the response
        res.send(excelBuffer);
    } catch (error) {
        res.status(202).json({ status: 0, message: error.message });
    }
}


const puppeteer = require('puppeteer')

async function generateHTMLPDFData(res, data, reportName, columns) {
    const headers = [];
    const headersData = [];
    const parsedColumns = JSON.parse(columns);

    parsedColumns.forEach(column => {
        headers.push(column.header);
        headersData.push(column.data.toString());
    });

    const columnWidth = 100 / headers.length;

    let html = `<table border="1" width="100%" style="border-collapse: collapse;margin-top: -10px;">`;

    if (data.length > 10000) {
        data = data.slice(0, 10000);
    }

    let headerTemplate = `
    <div style="display: grid; width:100%">
        <div style="text-align: center; font-variant: small-caps; margin-top: 5px; width:100%">
            <span style="font-size: 15px;">${reportName} <br/></span>
            <span style="font-size: 8px;">Generated by Uathayam &emsp; Generated on ${new Date().toLocaleString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric' })}</span>
        </div>
        <div style="width: 100%; margin-top: 15px;">
            <table border="1" width="100%" style="border-collapse: collapse;">
                <tr style="padding-right: 15px;padding-left: 15px; height:20px; font-size:10px;">
                    <th style="width: ${columnWidth}%; text-align: left;">${headers.join(`</th><th style="width: ${columnWidth}%; text-align: left;">`)}</th>
                </tr>
            </table>
        </div>
    </div>`;

    let footerTemplate = `
        <div style="width: 100%; font-size: 10px; text-align: center; padding-top: 5px; margin-top: 5px;">
            Page <span class="pageNumber"></span> of <span class="totalPages"></span>
        </div>`;

    data.forEach(row => {
        html += '<tr style="font-size:10px; height:20px;">';
        parsedColumns.forEach(column => {
            if((reportName == 'Inventory Report') || (reportName == 'Pallet Request Report')|| (reportName == 'Alarm History Report') || (reportName == 'User Report') || (reportName == 'Pre-Binning Report') || (reportName == 'Pallet Mapping Report') || (reportName == 'Location Mapping Report') || (reportName == 'Inventory Details Report'))
            {
                const cellValue = row[column.data] !== undefined ? row[column.data] : 'N/A';
                html += `<td style="width: ${columnWidth}%; text-align: left;">${cellValue}</td>`;
            }
            else
            { 
                const cellValue = row.dataValues[column.data] !== undefined ? row.dataValues[column.data] : 'N/A';
                html += `<td style="width: ${columnWidth}%; text-align: left;">${cellValue}</td>`;
            }
        });
        html += '</tr>';
    });

    html += `</table>`;

    try {
        const browser = await puppeteer.launch({
            headless: true,
            executablePath: 'E:\Craftsman\puppeteer \chrome\win64-134.0.6998.165\chrome-win64\chrome.exe',
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            dumpio: true,
        });

        const page = await browser.newPage();

        page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
        page.on('requestfailed', (request) => console.log(`Request failed: ${request.url()}`));

        await page.setContent(html, { waitUntil: 'networkidle0', timeout: 0 });

        const pdfBuffer = await page.pdf({
            format: 'A4',
            displayHeaderFooter: true,
            headerTemplate: headerTemplate,
            footerTemplate: footerTemplate,
            margin: {
                top: '100px',
                bottom: '100px'
            }
        });

        await browser.close();
        const filename = reportName.replace(/\s/g, '_') + '-' + formatDate(new Date());
        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename=${filename}.pdf`,
            'Content-Length': pdfBuffer.length
        });

        res.send(pdfBuffer);
    } catch (error) {
        console.error('Error generating PDF:', error);
        res.status(202).json({ status: 0, message: error.message });
    }
}



// module.exports = { generateCSVData, generateExcelData,generateHTMLPDFData };
module.exports = { exportData };
