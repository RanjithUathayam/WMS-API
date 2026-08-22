const { DataTypes } = require('sequelize');
const { sequelize }  = require('../../config/database');

const ERPUserManagement = sequelize.define('ERP_User_Management', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    UserName: {
        type: DataTypes.STRING,
        allowNull: true
    },
    Password: {
        type: DataTypes.STRING,
        allowNull: true
    }
}, {
    tableName: 'ERP_User_Management',
    timestamps: false,
    indexes: [
        {
            unique: true,
            fields: ['id']
        },
        {
            fields: ['UserName']
        }
    ]
});

module.exports = ERPUserManagement;
