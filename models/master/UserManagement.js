const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');

const userManagement = sequelize.define('UserManagement', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    FullName: {
        type: DataTypes.STRING,
        allowNull: true
    },
    UserName: {
        type: DataTypes.STRING,
        allowNull: false
    },
    Pwd: {
        type: DataTypes.STRING,
        allowNull: false
    },
    UserGroup:{
        type: DataTypes.STRING,
        allowNull: true
    },
    FingerPrint:{
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0
    }
}, {
    tableName: 'User_Management',
    timestamps: false,
    indexes: [
        {
            unique: true,
            fields: ['id']
        },
        {
            fields: ['UserName']
        },
        {
            fields: ['UserGroup']
        }
    ]
});

module.exports = userManagement;
