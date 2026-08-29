const { Op, literal } = require('sequelize');
const moment = require('moment');
const { sequelize } = require('../../config/database');
const { TableHints } = require('sequelize');

async function tableHeader(type){
    const model = require(`../../models/Table_Header`);
    const result = await model.findAll({ attributes: ['details'],where:{type:type}, tableHint: TableHints.NOLOCK });
    if(result && result[0].details){
        return result[0].details;
    }
    else {
        return [];
    }
}

async function userEntryLogList(req, res){
  try{
    const { fromDate, toDate, type, method = 'Load' } = req.body;
    let startDate = moment(fromDate).startOf('day').format('YYYY-MM-DD HH:mm:ss')
    let endDate = moment(toDate).endOf('day').format('YYYY-MM-DD HH:mm:ss')

    const query = `EXEC SP_EntryLog @Method = :method, @FromDate = :fromDate, @ToDate = :toDate, @Type = :type`;
    const result = await sequelize.query(query, {
      replacements: { method:method, fromDate:startDate, toDate:endDate, type:type },
      type: sequelize.QueryTypes.SELECT
    });

    const header=await tableHeader('UserEntryLog');

    res.status(200).json({status: 1, message: 'Success', header, data: result});
  }catch(error){
    res.status(202).json({status: 0, message: error.message});
  }
}

async function insertUserEntryLog(req, res){
  try{
    const { AccessDateTime, Type, UserName, MacAddress } = req.body;
    const AccessDateTimeConv = moment(AccessDateTime).format('YYYY-MM-DD HH:mm:ss.SSS');
    const query = `INSERT INTO EntryLog(AccessDateTime, Type, UserName, MacAddress) VALUES(:AccessDateTimeConv, :Type, :UserName, :MacAddress)`;
    const result = await sequelize.query(query, {
      replacements: { AccessDateTimeConv, Type, UserName, MacAddress },
      type: sequelize.QueryTypes.INSERT
    });

    res.status(200).json({status: 1, message: 'Success', data: result});
  }catch(error){
    res.status(202).json({status: 0, message: error.message});
  }
}

async function userLogList(req, res) {
    const Logindatetimesettings = require(`../../models/history/UserLog`);
    const { fromDate, toDate, macaddress, exportFormat='' } = req.query; // Changed to lowercase

    try
    {
        let whereCondition = {};

        if (fromDate && toDate)
        {
            whereCondition.Logindate = {
                [Op.between]: [
                literal(`CONVERT(DATETIME, '${fromDate}')`),
                literal(`CONVERT(DATETIME, '${toDate}')`)
                ]
            };
        }
        else if (fromDate && !toDate)
        {
            whereCondition.Logindate = {
                [Op.gte]: literal(`CONVERT(DATETIME, '${fromDate}')`)
            };
        }
        else if (!fromDate && toDate)
        {
            whereCondition.Logindate = {
                [Op.lte]: literal(`CONVERT(DATETIME, '${toDate}')`)
            };
        }


        const loginData = await Logindatetimesettings.findAndCountAll({
          attributes: [
              'Username',
              [
                  sequelize.literal(
                      "(CONVERT(VARCHAR(10), Logindate, 103) + ' ' + CONVERT(VARCHAR(8), Logintime, 108))"
                  ),
                  'Logindate'
              ],
              [
                  sequelize.literal(
                      "(CONVERT(VARCHAR(10), Logindate, 103) + ' ' + CONVERT(VARCHAR(8), Logintime, 108))"
                  ),
                  'Logintime'
              ],
              [
                  sequelize.literal(
                      "(CONVERT(VARCHAR(10), Logindate, 103) + ' ' + CONVERT(VARCHAR(8), Logouttime, 108))"
                  ),
                  'Logouttime'
              ]
          ],
          where: whereCondition,
          order: [['id', 'DESC']],
          tableHint: TableHints.NOLOCK
      });


        const header=await tableHeader('UserLoginLog');
        if(exportFormat=='')
        {
            res.status(200).json({ status: 1, message: 'Success',header, data: loginData.rows, totalCount: loginData.count });
        }
        else
        {
            const {exportData} = require('../../models/Export');
            await exportData(res,exportFormat,`User Login Report`,header,loginData.rows);
        }
    }
    catch (error)
    {
        res.status(202).json({status: 0, message: error.message});
    }
}

module.exports = {
    userEntryLogList,
    insertUserEntryLog,
    userLogList,
};
