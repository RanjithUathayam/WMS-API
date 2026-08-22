const { DataTypes } = require('sequelize');
const {sequelize} = require('../config/database');

const CustomerAPILog = sequelize.define('CustomerAPILog', {
    Id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    URL: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    RequestBody: {
        type: DataTypes.JSONB,
        allowNull: true,
    },
    RequestedDateTime: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: sequelize.literal('GETDATE()'),
    },
    ResponseBody: {
        type: DataTypes.JSONB,
        allowNull: true,
    },
    ResponseDateTime: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    StatusCode: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    UserName: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    Duration:{
        type: DataTypes.INTEGER,
        allowNull: false
    }
}, {
tableName: 'Customer_api_logs',
timestamps: false,
indexes: [
    { name: 'reference_id_index', fields: ['ReferenceID'] }, // Use the correct column name
    { name: 'url_index', fields: ['URL'] },
    { name: 'user_name_index', fields: ['UserName'] },
],
});

module.exports = CustomerAPILog;
