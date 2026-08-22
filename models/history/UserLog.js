const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');

const Logindatetimesettings = sequelize.define('Logindatetimesettings', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    Username: {
        type: DataTypes.STRING,
        allowNull: false
    },
    Logindate: {
        type: DataTypes.DATEONLY,
        allowNull: false
    },
    Logintime: {
        type: DataTypes.TIME,
        allowNull: false
    },
    Logouttime: {
        type: DataTypes.TIME,
        allowNull: false
    }
}, {
    tableName: 'Logindatetimesettings',
    timestamps: false // If the table doesn't have createdAt and updatedAt fields
});

module.exports = Logindatetimesettings;
