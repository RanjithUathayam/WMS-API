const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');
 
const LoginHistory = sequelize.define('LoginHistory', {
    UserName: {
        type: DataTypes.STRING,
        allowNull: false
    },
    UserId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    SESSION_ID: {
        type: DataTypes.STRING,
        allowNull: false,
        primaryKey: true
    },
    SESSION_START: {
        type: DataTypes.STRING,
        allowNull: false
    },
    SESSION_END: {
        type: DataTypes.STRING,
        allowNull: true
    },
    STATUS: {
        type: DataTypes.STRING,
        allowNull: false
    }
}, {
    tableName: 'T_LOGIN_HISTORY',
    timestamps: false
});
 
module.exports = LoginHistory;