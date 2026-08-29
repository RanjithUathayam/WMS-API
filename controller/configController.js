const { sequelize } = require('../config/database');

const getPickStationData = async(req,res) =>{
    try
    {
        const result = await sequelize.query(`select * from Master_Station_Conveyor WITH (NOLOCK) where MacAddress = '${req.body.MacAddress}'`, {
            type: sequelize.QueryTypes.SELECT
        });

        res.status(200).json({ status: 1, message: 'Data Get Successfully', data: result });
    }
    catch (error)
    {
        res.status(202).json({status: 0, message: error.message});
    }
}

module.exports = {
    getPickStationData,
}
