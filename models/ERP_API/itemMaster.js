const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');

const ERPItemMaster = sequelize.define('ERPItemMaster', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    ItemCode: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false
    },
    ItemName: {
        type: DataTypes.STRING,
        allowNull: false
    },
    ItemGroup: {
        type: DataTypes.STRING,
        allowNull: false
    },
    Category: {
        type: DataTypes.STRING,
        allowNull: false
    },
    Description: {
        type: DataTypes.STRING,
        allowNull: false
    },
    Color: {
        type: DataTypes.STRING,
        allowNull: false
    },
    Size: {
        type: DataTypes.STRING,
        allowNull: false
    },
    Style: {
        type: DataTypes.STRING,
        allowNull: false
    },
    BinCapacity: {
        type: DataTypes.BIGINT,
        allowNull: false
    },
    Field1: {
        type: DataTypes.STRING,
        allowNull: true
    },
    Field2: {
        type: DataTypes.STRING,
        allowNull: true
    },
    Field3: {
        type: DataTypes.STRING,
        allowNull: true
    },
    isDelete: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    CreatedDate: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue:sequelize.literal('GETDATE()')
    },
    CreatedBy: {
        type: DataTypes.STRING,
        allowNull: false
    },
    UpdatedDate: {
        type: DataTypes.DATE,
        allowNull: true,
      //  defaultValue:sequelize.literal('GETDATE()')
    },
    UpdatedBy: {
        type: DataTypes.STRING,
        allowNull: true
    },
    DeletedDate: {
        type: DataTypes.DATE,
        allowNull: true,
      //  defaultValue:sequelize.literal('GETDATE()')
    },
    DeletedBy: {
        type: DataTypes.STRING,
        allowNull: true
    },
    ActivatedDate: {
        type: DataTypes.DATE,
        allowNull: true,
        //defaultValue:sequelize.literal('GETDATE()')
    },
    ActivatedBy: {
        type: DataTypes.STRING,
        allowNull: true
    },
    isActive: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: 'N'
    }
}, {
    tableName: 'Master_Part',
    timestamps: false,
    indexes: [
        {
            unique: true,
            fields: ['id']
        },
        {
            fields: ['ItemCode']
        }
    ]
});

module.exports = ERPItemMaster;