const express = require('express');
const cors = require('cors');
const app = express();
const bodyParser = require('body-parser');
const authenticateToken = require('./authenticateToken');

const projectRoutes = require('./routes/projectRoutes');
const masterRoutes = require('./routes/masterRoutes');
const historyRoutes = require('./routes/historyRoutes');
const operationRouter = require('./routes/operationRouter');
const ERPRouter = require('./routes/ERPRoutes')
const HHTRouter = require('./routes/HHTRouter')
const preBinningRoutes = require('./routes/preBinningRoutes')
const labelPrintRoutes = require('./routes/labelPrintRoutes')
const labelReservationRoutes = require('./routes/labelReservationRoutes')
const locationRoutes = require('./routes/locationRoutes')
const locationMappingRoutes = require('./routes/locationMappingRoutes')
const palletMappingRoutes = require('./routes/palletMappingRoutes')
const pickingRoutes = require('./routes/pickingRoutes')
const reportRoutes = require('./routes/reportRoutes')
const transactionRoutes = require('./routes/transactionRoutes');
const dataRoutes = require('./routes/dataRoutes');
const masterExport = require('./routes/masterExport')
const configRouter = require('./routes/configRouter')

const http = require('http');
const server = http.createServer(app);

app.use(express.json());
app.use(express.json({ limit: '1gb' }));
app.use(bodyParser.json({ limit: '1gb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '1gb' }));
// Chrome/Edge Private Network Access: a page loaded from a routable address (e.g. the central
// server's IP) calling a loopback/local-network address (the printer agent on localhost) requires
// this header on the preflight response, or the browser silently blocks the request as a network
// error — the `cors` package (2.8.6) doesn't send it on its own.
app.use((req, res, next) => {
    if (req.headers['access-control-request-private-network']) {
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    next();
});
app.use(cors({ origin: '*' }))


// Serve Angular app
app.use(express.static('public'));

// app.use(authenticateToken);
app.use('/api', projectRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/master',authenticateToken, masterRoutes); //authenticateToken,
app.use('/api/masterExport', masterExport);
app.use('/api/history', authenticateToken, historyRoutes); //authenticateToken,
app.use('/api/operation',authenticateToken, operationRouter);
app.use('/api/transaction', authenticateToken, transactionRoutes);
app.use('/api/ERP', authenticateToken, ERPRouter)
app.use('/api/HHT',authenticateToken, HHTRouter)
app.use('/api/config',authenticateToken, configRouter)
app.use('/api/pre-binning', authenticateToken, preBinningRoutes)
app.use('/api/label-print', authenticateToken, labelPrintRoutes)
app.use('/api/label', authenticateToken, labelReservationRoutes)
app.use('/api/location', authenticateToken, locationRoutes)
app.use('/api/location-mapping', authenticateToken, locationMappingRoutes)
app.use('/api/pallet-mapping', authenticateToken, palletMappingRoutes)
app.use('/api/picking', authenticateToken, pickingRoutes)
app.use('/api/reports', authenticateToken, reportRoutes)
const PORT = process.env.PORT || 3300//8083;

// Use server variable to listen instead of app
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
