Product Traceability Web Application – Functional Requirements
Overview

The purpose of this web application is to provide complete traceability of products manufactured within the facility.

Each product has a unique QR code attached to it. The QR code will be generated directly by the application, so the system must include a built-in QR code generation module.

As products move through the production process, they pass through multiple stations. At each station, operators, robots, barcode readers, or PLCs will write data associated with the product.

The data written at each station may include:

OK/NOK status information
Process values received from PLCs
Batch number associations
Operator information
Timestamps
Alarms and warnings

Products must follow a predefined route. If an operation is attempted outside the defined route, the system must reject the operation and generate an appropriate warning.

Core Concepts

The application should be based on the following entities:

Products (Shells)
Trolleys
Stations
Routes
PLC data
Batch numbers
Operators
Alarms
Process records
QR Code Generator Station

This is the first station in the process.

Responsibilities
Generate a unique product identifier (Product ID).
Generate a QR code containing the Product ID.
Print a label containing:
The QR code image
The Product ID text
Trolley Assignment Station

At this station, products are loaded onto a trolley by a robot.

Process flow
The trolley QR code is scanned before entering the robot area.
The robot scans the product QR code.
The robot places the product into one of the twenty trolley positions.
The robot performs the funnel tightening operation.
Stored information

The following information must be linked to the product:

Product ID
Trolley ID
Trolley slot number (1–20)
Funnel tightening torque value
Timestamp
Filling Station

Products arrive at this station on trolleys.

Process flow
The trolley QR code is scanned automatically.
Four products are filled simultaneously.
After the filling cycle is completed, the trolley advances one position.
This process continues until all twenty products are filled.

The product QR codes are not scanned at this station because the relationship between the trolley and the products has already been established.

The PLC will provide information about the trolley position currently being processed. Based on this information, the application will determine which four products should receive the corresponding data.

Process data

The following data must be stored for each product:

Shell temperature
Material temperature
Tank pressure
Additional process parameters (configurable)
Material batch number

Material batch numbers will be managed independently from the production route.

Probing Station

At this station, all twenty products are processed simultaneously.

Process flow
The trolley QR code is scanned.
The PLC sends process data after the operation is completed.
The system associates the data with all products on the trolley.
Process data
Shell temperature
Ambient temperature
Processing duration
Conditioning Station
Entry procedure
The trolley QR code is scanned.
The trolley remains in the conditioning chamber for 24 hours.
Exit procedure
The trolley QR code is scanned again.
If the trolley is removed before the required waiting period is completed, an alarm signal must be sent to the PLC.
The operation must be rejected.
Completion procedure

When the required conditions are satisfied, a conditioning OK status is assigned to every product on the trolley.

Drilling Station
Process flow
The product QR code is scanned.
An OK/NOK status is assigned to the product.
X-Ray Station
Process flow
The product QR code is scanned.
An OK/NOK status is assigned to the product.
Painting Station
Process flow
The product QR code is scanned.
An OK/NOK status is assigned to the product.
Manual Workstation

At this station, components are assembled onto the product.

Process flow
The operator scans the component batch number.
The operator scans the product QR code.
The relationship between the component and the product is created.
The product is placed onto a pallet.
An OK/NOK status is recorded.
Stored information
Product ID
Component batch number
Operator information
Assembly status
Configurable Station Architecture

The system must be fully configurable.

Users must be able to:

Add new stations.
Remove existing stations.
Modify station configurations.
Define station routes.
Enable or disable station capabilities.
Station Capabilities

Every station should support one or more of the following capabilities:

QR code generation
Product-to-trolley assignment
Product-to-batch assignment
OK/NOK validation
PLC data acquisition
Waiting-time control
Alarm generation
Printing
Operator confirmation
Route validation
Dynamic User Interface

The user interface should adapt automatically according to the capabilities assigned to a station.

For example:

A PLC station should display PLC-related controls.
An OK/NOK station should display approval controls.
A batch association station should display scanning fields.
A waiting station should display timers and alarms.
Task Management

The system should continuously verify that all mandatory operations have been completed.

Examples include:

Has the PLC data been recorded?
Has the operator entered the OK/NOK result?
Has the batch number been assigned?
Has the product remained in the station for the required time?
Has the route been followed correctly?

Only after all required tasks have been completed should the product be allowed to proceed to the next station.