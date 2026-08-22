const User = require('../models/login/login')
const LoginHistory = require('../models/login/loginhistory');
const UserGroup = require('../models/master/UserGroup');
const MasterHHT = require('../models/master/MasterHHT')
const Logindatetimesettings = require('../models/history/UserLog');
const { Op, where } = require('sequelize');
let jwt = require('jsonwebtoken');
const moment = require('moment');
const { sequelize } = require('../config/database');
const { TableHints } = require('sequelize');

async function tableHeader(type){
    const model = require(`../models/Table_Header`);
    const result = await model.findAll({ attributes: ['details'],where:{type:type}, tableHint: TableHints.NOLOCK });
    if(result && result[0].details){
      return result[0].details;
    } 
    else {
      return [];
    }
  }

/* Master */
//Login Data
const loginVerify = async (req, res) => {
    const { username, password, deviceId, deviceModel, deviceOS, deviceOSVersion  } = req.body;

    let UserId = '';
    const SESSION_START = moment(new Date()).format("YYYY-MM-DD hh:mm:ss");
    const SESSION_END = null;
    const STATUS = "RUNNING";
    let DeviceIdentityValue = '';
    try 
    {
        //User Details checking
        const user = await User.findOne({ where: { 'username': username, 'Pwd': password }, tableHint: TableHints.NOLOCK });
        if (!user) 
        {
            return res.status(202).json({ status: 0, message: 'Invalid username and password' });
        }

        //User Rights
        const userRight = await UserGroup.findOne({ where: { 'groupname': user.UserGroup }, tableHint: TableHints.NOLOCK });
        let rights = '';
        if (userRight) 
        {
            rights = userRight.rights;
        }
        user['rights'] = rights;
        if(deviceId)
        {
            //Device details checking
            const deviceList = await MasterHHT.findOne({where:{'deviceId':req.body.deviceId, 'deviceModel':req.body.deviceModel, 'deviceOS':req.body.deviceOS, 'deviceOSVersion':req.body.deviceOSVersion}, tableHint: TableHints.NOLOCK}) 
            
            if(deviceList)
            {
                if(deviceList.dataValues.Rights)
                {
                    let hasListRight = rights.includes('preBinning_list');
                    let hasCreatesRight = rights.includes('preBinning_creates');

                    if(!hasListRight && !hasCreatesRight)
                    {
                        return res.status(202).json({ status: 0, message: `Please Contact admin for User access...! Your User Name -${username}` });
                    }
                    else
                    { 
                        DeviceIdentityValue = deviceList.dataValues.deviceRefID
                        //Update Current User
                        let  updatedDate = sequelize.literal('GETDATE()');
                        await MasterHHT.update({currentUser: username, UpdatedBy: username, UpdatedDate: updatedDate},{where:{deviceRefID:deviceList.dataValues.deviceRefID}});
                    }
                }
                else
                {
                    return res.status(202).json({ status: 0, message: `Please Contact admin for Device access...! Your Device ID HHT-${deviceList.dataValues.deviceRefID}` });
                }
            }
            else
            {
                const newDevice = await MasterHHT.create({
                    deviceId: deviceId,
                    deviceModel: deviceModel,
                    deviceOS: deviceOS,
                    deviceOSVersion: deviceOSVersion,
                    currentUser: username,
                    CreatedBy: username
                });
                
                DeviceIdentityValue = newDevice.deviceRefID;
                return res.status(200).send({
                    status: 0,
                    message: `Request Submitted, Please Contact admin for Device access...! Your Device ID HHT-${DeviceIdentityValue}`
                });
            }
        }


        //For User Log Data
        let insertedId = '';
        const Logindatetimesettings = require(`../models/history/UserLog`);
        //For logout time set for existing user
        try{
            const updateLoginData = await Logindatetimesettings.update(
                {
                  Logouttime: moment().format("YYYY-MM-DD HH:mm:ss.SSSSSSS")   
                },
                {
                  where: {
                    [Op.or]: [
                      { Logouttime: '0001-01-01 00:00:00.0000000' },   
                    ],
                    Username: user.UserName
                  }
                }
              );
        }
        catch(error){
        if (error) {
            console.error('Error updating login session:', error);
        } 
        }

        try {
            const newSession = await Logindatetimesettings.create({
                Username: username,
                Logindate: moment(SESSION_START).format("YYYY-MM-DD"),
                Logintime: moment(SESSION_START).format("HH:mm:ss"),
                Logouttime: SESSION_END ? moment(SESSION_END).format("HH:mm:ss") : "00:00:00"
            }, { returning: true });
        
            insertedId = newSession.id; 
        } catch (error) {
            console.error('Error creating login session:', error);
        }

        // Check for existing session with status "RUNNING"  //For LoginHistory Table
        const existingSession = await LoginHistory.findOne({
            where: { UserId: user.id, STATUS: 'RUNNING' },
            tableHint: TableHints.NOLOCK
        });
 
  
        let SESSION_ID;
        if (existingSession) 
        { 
            SESSION_ID = existingSession.SESSION_ID; 
        }
        else 
        {
            // Create a new session ID
            SESSION_ID = sequelize.literal('GETDATE()');  
            await LoginHistory.create({
                UserName: username,
                UserId: user.id,
                SESSION_ID: SESSION_ID,
                SESSION_START: SESSION_START,
                SESSION_END: SESSION_END,
                STATUS: STATUS
            });
        }

       
        // Generate JWT token
        const token = jwt.sign({ userId: user.id, userGroup: user.UserGroup }, 'CAL-WMS', { expiresIn: '24h' });

        res.status(200).json({
            status: 1,
            data: user,
            rights,
            token: token,
            DeviceID: DeviceIdentityValue,
            sessionData: {
                SESSION_ID: SESSION_ID,
                SESSION_START: SESSION_START,
                SESSION_END: SESSION_END,
                STATUS: STATUS,
                logoutID: insertedId ,
                UserName: user.UserName
            }
        });
    } 
    catch (error) 
    {
        res.status(202).json({ status: 0, message: error.message });
    }
};



const logout = async(req,res) =>{
    const  sessionId  = req.body;
    const Logindatetimesettings = require(`../models/history/UserLog`);
    
    
    if(sessionId.session_id == null){
        return res.status(202).json({ status: 0, message: 'Invalid sessionId' });
    }
 
    const session_id = sessionId.session_id.SESSION_ID;
    const logoutID = sessionId.session_id.logoutID 
    try
    {
        let SESSION_END = sequelize.literal(`'${moment(new Date()).format('YYYY-MM-DD HH:mm:ss.SSS')}'`)
        let STATUS = 'COMPLETED'
        await LoginHistory.update({SESSION_END:SESSION_END,STATUS:STATUS},{where:{SESSION_ID:session_id}});
        await Logindatetimesettings.update({Logouttime: moment(SESSION_END).format("HH:mm:ss")},{where:{id:logoutID}}); 
        res.status(200).json({ status: 1, message: 'Logout Successfull' });
    }
    catch (error) {
        res.status(202).json({status: 0, message: error.message});
    }
}
//ChangePassword Data
const changePassword = async(req,res) =>{
    const { userId,oldPassword, password } = req.body;
    try 
    {
        const user = await User.findOne({ where: { 'id':userId, 'Pwd':oldPassword },tableHint: TableHints.NOLOCK });
        
        if (!user) 
        {
            return res.status(202).json({ status: 0, message: 'Incorrect Old Password' });
        }
        else if(password == oldPassword){
            return res.status(202).json({ status: 0, message: 'Old and New Password Should not be same' });
        }
        else if(password =='' || password == null){
            return res.status(202).json({ status: 0, message: 'Enter New Password' });
        }
        else if(password.length < 6 || password.length > 20){
            return res.status(202).json({ status: 0, message: 'Password should be between 6 to 20 characters' });
        }

        await User.update({Pwd:password},{where:{id:userId}});
        res.status(200).json({ status: 1, message: 'Password Changed Successfully' });
    } 
    catch (error) {
        res.status(202).json({status: 0, message: error.message});
    }
}

//Operation Modules
//Storage Details
const storageUploadData = async (req, res) => {
    try {
        const dataArray = req.body;

        // Check if the array is not empty
        if (!Array.isArray(dataArray) || dataArray.length === 0) {
            return res.status(400).json({ status:0, message: 'Invalid or empty array' });
        }
    
        // Validate mandatory fields for each row
        const invalidRows = dataArray.filter(row => !row.PalletID && !row.ProductName && !row.Qty && !row.PackSize && !row.PalletRejectionFlag);
    
        if (invalidRows.length > 0) {
            return res.status(400).json({ status:0, message: 'Some rows have missing mandatory fields', invalidRows });
        }
    
        // Insert valid rows into the database
        const insertedRows = await YourModel.bulkCreate(dataArray, { returning: true,ignoreDuplicates: true });
    
        // Insert users into the database using Sequelize
        //const createdUsers = await storageData.bulkCreate(usersArray, { ignoreDuplicates: true });
    
       // res.status(202).json({ message: 'Users inserted successfully', data: createdUsers });
    } 
    catch (error) {
        res.status(202).json({status: 0, message: error.message});
    }
}

const TruncateTable = async (days = 1, batchSize = 6000) => {
    try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days); 
        const formattedDate = cutoffDate.toISOString().slice(0, 19).replace('T', ' ');   
        
        // Start deleting in batches
        let deletedRows = 0;
        let hasMoreRows = true;

        while (hasMoreRows) {
            const query = `
                DELETE TOP (${batchSize}) FROM api_logs
                WHERE RequestedDateTime < '${formattedDate}'
            `;
            const result = await sequelize.query(query);
            deletedRows += result[0].affectedRows;

            if (result[0].affectedRows <= batchSize) {
                hasMoreRows = false;  // Stop if less than batchSize rows were deleted
            }
        }
    } catch (err) {
        console.log('Error deleting old records:', err.message);
    }
};

module.exports = {
    loginVerify,
    logout,
    changePassword,
    storageUploadData,
    TruncateTable
}