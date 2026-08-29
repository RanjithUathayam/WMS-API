const { Op } = require('sequelize');
const PreBinning = require('../models/ERP_API/PreBinning')
const MasterPart = require('../models/master/MasterPart')
const MasterHHTDevice = require('../models/HHT/deviceRights');
const { TableHints } = require('sequelize');

const getGRNDetails = async (req, res) => {
    try {
        const { GRNNo, FilterGRNNo, ItemCode, BinID } = req.body;

        const where = {};
        // Add GRNNo filter only if it's not 'All'
        if (GRNNo && GRNNo !== 'All') {
            where.GRNNo = GRNNo;
        }

        // Add LIKE conditions only if the values are provided
        if (FilterGRNNo) {
            where.GRNNo = { [Op.like]: `%${FilterGRNNo}%` };
        }
        if (ItemCode) {
            where.ItemCode = { [Op.like]: `%${ItemCode}%` };
        }
        if (BinID) {
            where.BinID = { [Op.like]: `%${BinID}%` };
        }

        const grnDetails = await PreBinning.findAll({ where: where, limit: 300, tableHint: TableHints.NOLOCK });

        if (!grnDetails.length) {
            return res.status(200).json({ status: 1, message: 'GRN Not Found', data: [] });
        }

        // Fetch related MasterPart data in parallel
        const grnList = await Promise.all(grnDetails.map(async (grn) => {
            const grnData = grn.dataValues;
            const itemData = await MasterPart.findOne({ where: { ItemCode: grn.ItemCode }, tableHint: TableHints.NOLOCK });

            if (itemData?.dataValues) {
                grnData.itemGroup = itemData.ItemGroup;
                grnData.BinCapacity = itemData.BinCapacity;
                grnData.Color = itemData.Color;
            }

            return grnData;
        }));

        return res.status(200).json({
            status: 1,
            message: 'GRN Data fetched successfully.',
            data: grnList,
        });

    } catch (error) {
        return res.status(500).json({ status: 0, message: error.message });
    }
};

const giveDeviceRights = async (req, res) => {
    try {
        const data = req.body;

        const device = await MasterHHTDevice.findOne({ where: { deviceId: data.deviceId }, tableHint: TableHints.NOLOCK });
        if (device) {
            await MasterHHTDevice.update({ Rights: data.Rights,UpdatedBy: data.currentUser}, { where: { deviceId: data.deviceId } });
            res.status(200).json({ status: 1, message: 'Device rights updated successfully' });
        } else {
            res.status(404).json({ status: 0, message: 'Device not found' });
        }
    } catch (error) {
        res.status(500).json({ status: 0, message: error.message });
    }
};

const getDevices = async (req, res) => {
    try {
        const devices = await MasterHHTDevice.findAll({tableHint: TableHints.NOLOCK});
        res.status(200).json({ status: 1, data: devices });
    } catch (error) {
        res.status(500).json({ status: 0, message: error.message });
    }
};

module.exports = {
    getGRNDetails,
    giveDeviceRights,
    getDevices,
}
