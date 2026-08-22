const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');

const MasterStation = sequelize.define('MasterStation', {
    id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        allowNull: false,
        autoIncrement: true,
    },
    ST_Code: {
        type: DataTypes.STRING(200),
        allowNull: true
    },
    ST_Description: {
        type: DataTypes.STRING(200),
        allowNull: true
    },
    StationAssigned: {
        type: DataTypes.BIGINT,
        allowNull: true
    },
    Floor: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    GTPStation: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    UpdateDateTime: {
        type: DataTypes.DATE,
        allowNull: true
    },
    UserName: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    OrderNo: {
        type: DataTypes.STRING,
        allowNull: true
    }
}, {
    // Other model options
    tableName: 'Master_Station_Conveyor',
    timestamps: false 
});

module.exports = MasterStation;