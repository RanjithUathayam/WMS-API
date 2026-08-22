// Import required modules
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database'); // Adjust the path as needed

// Define the model
const TableHeader = sequelize.define('TableHeader', {
    Id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    type: {
        type: DataTypes.STRING, // Adjust the data type as needed
        allowNull: true
    },
    details: {
        type: DataTypes.TEXT, // Adjust the data type as needed
        allowNull: true
    }
}, {
    tableName: 'Table_Header',
    timestamps: false // If the table doesn't have createdAt and updatedAt fields
});

// Export the model
module.exports = TableHeader;
