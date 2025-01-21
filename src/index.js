const SerialPort = require('serialport')
const GSMErrors = require('./errors')
const Parser = require('./parsing')
const Constants = require('./constants')

const GSM_PROMPT = ">"
const TIMEOUT_DEFAULT = 5000
const TIMEOUT_LONG = 20000
const CTRL_Z = "\x1A"

class GSM {

    /**
     * 
     * @param {String} path - A path to the GSM Modem device (ex: '/dev/gsmmodem')
     * @param {object} options - An options object
     * @param {?number} options.baudRate - The baudrate to use, defaults to 460800
     */
    constructor(path, options) {
        this.path = path
        this.connected = false
        this.isWaiting = false
        this.gpsIsOn = false
        this.serialPort = new SerialPort(path, {
            baudRate: options?.baudRate ?? 460800,
            autoOpen: false
        })
        this.parser = new Parser()
    }

    /**
     * Connects to GSM modem serial port. 
     */
    async connect() {
        if (this.connected) {
            throw new Error('Already connected');
        }
        return new Promise((resolve, reject) => {
            this.serialPort.open((error) => {
                if (error) {
                    return reject(`Error connecting to serial port: '${error}'`)
                }
                this.connected = true
                resolve()
            })

            this.serialPort.on('close', () => {
                this.connected = false
                console.debug("Serial port closed")
            })

            this.serialPort.on('error', (error) => {
                this.connected = false
                console.debug(`Serial port error: ${error}`)
            })
        })
    }

    /**
     * Disconnects from GSM modem serial port.
     */
    disconnect() {
        this.serialPort.close()
        this.connected = false
    }

    /**
     * returns no errors if the modem is operational
     */
    async check() {
        return await this.runCommand("AT")
    }

    /**
     * Returns the manufacturer identification.
     */
    async getManufacturerInformation() {
        return await this.runCommand("AT+CGMI")
    }

    /**
     * Returns the model identification.
     */
    async getModelIdentification() {
        let result = await this.runCommand("AT+CGMM")
        return result.replace("+CGMM:","")
    }

    /**
     * Returns the software revision identification.
     */
    async getRevisionIdentification() {
        let result = await this.runCommand("AT+CGMR")
        return result.replace("+CGMR:","")
    }

    /**
     * Returns the equipment supported command set list. 
     * Where:
     *    +CGSM: GSM ETSI command set 
     *    +FCLASS: Fax command set 
     *    +DS: Data Service common modem command set 
     *    +MS: Mobile Specific command set
     */
    async getCapabilitiesList() {
        let result = await this.runCommand("AT+GCAP")
        return result.replace("+GCAP: ","").split(",")
    }

    /**
     * Returns the device board serial number. 
     */
    async getSerialNumber() {
        return await this.runCommand("AT+CGSN", TIMEOUT_LONG)
    }

    /**
     * Returns the value of the Internal Mobile Subscriber Identity stored in the SIM without command echo.
     */
    async getSubscriberId() {
        const result = await this.runCommand("AT+CIMI", TIMEOUT_LONG)
        return result.replace("+CIMI:","")
    }

    /**
     * Execution command returns the subscriber number i.e. the phone number of the device that is stored in the SIM card.
     */
    async getSubscriberNumber() {
        const result = await this.runCommand("AT+CNUM")
        return result.replace("+CNUM:","")    
    }

    /**
     * Returns information about the device
     */
    async getIdentificationInformation() {
        return await this.runCommand("ATI")
    }

    /**
     * Returns the wireless module connection mode (data, fax, voice),
     */
    async getActiveServiceClass() {
        return await this.runCommand("AT+FCLASS?")
    }

    /**
     * Sets the wireless module in specified connection mode (data, fax, voice), 
     * hence all the calls done afterwards will be data or voice.
     * @param {GSM.ServiceClass} serviceClass 
     */
    async setActiveServiceClass(serviceClass) {
        return await this.runCommand(`AT+FCLASS=${serviceClass}`)
    }

     /**
     * Starts a call to the phone number given as parameter.
     * @param {String} number - Phone number to be dialed 
     * Note: the numbers accepted are 0-9 and *,#,”A”, ”B”, ”C”, ”D”,”+”. 
     * Note: type of call (data, fax or voice) depends on last Active Service Class (+FCLASS) setting.
     */
    async dial(number) {
        return await this.runCommand(`ATD${number}`)
    }

    /**
     * Starts a voice call to the phone number given as parameter.
     * @param {String} number - Phone number to be dialed 
     * Note: the numbers accepted are 0-9 and *,#,”A”, ”B”, ”C”, ”D”,”+”. 
     */
    async dialVoice(number) {
        return await this.runCommand(`ATD${number};`)
    }

     /**
     * Answer an incoming call if automatic answer is disabled. 
     */
    async answer() {
        return await this.runCommand("ATA")
    }

    /**
     * Get the number of rings required before device automatically answers an incoming call. 
     *  0 means auto answer is disabled
     */
    async getAutoAnswerRings() {
        return parseInt(await this.runCommand("ATS0?"))
    }

    /**
     * Sets the number of rings required before device automatically answers an incoming call
     * @param {Number} numberOfRings - number of rings before answer (between 0 to 255). Set to 0 to disable auto answer.
     */
    async setAutoAnswerRings(numberOfRings) {
        return parseInt(await this.runCommand(`ATS0=${numberOfRings}`))
    }

    /**
     * Execution command is used to close the current conversation (voice, data or fax).
     * Note: this command can be issued only in command mode; 
     */
    async hangup() {
        return await this.runCommand("AT+CHUP")
    }

    /**
     * Gets the current character set used by the device.
     */
    async getCharacterSet() {
        let result = await this.runCommand("AT+CSCS?")
        return result.replace("CSCS: ","").trimQuotes()
    }

    /**
     * Sets the current character set used by the device. 
     * @param {GSM.CharacterSet} characterSet 
     */
    async setCharacterSet(characterSet) {
        return await this.runCommand(`AT+CSCS="${characterSet}"`)
    }

    /**
     *  Reports received signal quality
     */
    async getSignalQuality() {
        const result = await this.runCommand("AT+CSQ")
        return this.parser.parseSignalQuality(result)
    }

    /**
     * Returns the current GSM network operator selection
     */
    async getCurrentOperator() {
        const result = await this.runCommand("AT+COPS?")
        const parts = result.replace("+COPS: ","").split(",")
        if (parts[2]) {
            return parts[2].trimQuotes()
        }
        return "Unknown"
    }

    /**
     * Selects phonebook memory storage
     * @param {GSM.PhoneBookStorage} storage - Phone book storage type
     */
    async setPhoneBookStorage(storage) {
        await this.runCommand(`AT+CPBS="${storage}"`)
    }

    /**
     * Returns for a given phone book storage the maximum number of contacts and the used contact slots
     * @param {GSM.PhoneBookStorage} phoneBook - Phone book storage type
     */
    async getPhoneBookUsage(phoneBook) {
        await this.setPhoneBookStorage(phoneBook)
        const result = await this.runCommand(`AT+CPBS?`)
        const splitted = result.split(",")
        return {
            used: parseInt(splitted[1]),
            capacity: parseInt(splitted[2])
        }
    }

    /**
     * Returns a range of contacts for a given phone book
     * @param {GSM.PhoneBookStorage} phoneBook - Phone book storage type
     * @param {Number} startIndex - Lower edge of the contact index to fetch
     * @param {Number} endIndex  - Upper edge of the contact index to fetch
     */
    async readPhoneBook(phoneBook, startIndex, endIndex) {
        await this.setPhoneBookStorage(phoneBook)
        await this.setCharacterSet(GSM.CharacterSet.UCS2)
        const result = await this.runCommand(`AT+CPBR=${startIndex},${endIndex}`, TIMEOUT_LONG)
        return this.parser.parseContacts(result)
    }

    /**
     * Adds a new contact to the end of a given phone book
     * @param {GSM.PhoneBookStorage} phoneBook - Phone book storage type
     * @param {String} number - The phone number of the contact
     * @param {GSM.PhoneNumberType} numberType - Phone number type
     * @param {String} text - Contact name
     */
    async addContact(phoneBook, number, numberType, text) {
        await this.setPhoneBookStorage(phoneBook)
        await this.setCharacterSet(GSM.CharacterSet.UCS2)
        await this.runCommand(`AT+CPBW=,"${number}",${numberType},"${text.UCS2HexString()}"`, TIMEOUT_LONG)
    }

    /**
     * Removes a contact from a given phone book at a given index
     * @param {GSM.PhoneBookStorage} phoneBook - Phone book storage type
     * @param {Index} index - The index of the contact to delete
     */
    async deleteContact(phoneBook, index) {
        await this.setPhoneBookStorage(phoneBook)
        await this.runCommand(`AT+CPBW=${index}`, TIMEOUT_LONG)
    }

    /**
     * Updates or creates a contact from a given phone book at a given index
     * @param {GSM.PhoneBookStorage} phoneBook - Phone book storage type
     * @param {Number} index - The index of the contact to update
     * @param {String} number - The phone number of the contact
     * @param {GSM.PhoneNumberType} numberType - Phone number type
     * @param {String} text - Contact name
     */
    async setContact(phoneBook, index, number, numberType, text) {
        await this.setPhoneBookStorage(phoneBook)
        await this.setCharacterSet(GSM.CharacterSet.UCS2)
        await this.runCommand(`AT+CPBW=${index},"${number}",${numberType},"${text.UCS2HexString()}"`, TIMEOUT_LONG)
    }

    /**
     * 
     * @param {GSM.MessageStorage} readStorage - memory from which messages are read and deleted
     */
    async setPreferredMessageStorage(readStorage) {
        return await this.runCommand(`AT+CPMS="${readStorage}","${GSM.MessageStorage.sim}","${GSM.MessageStorage.sim}"`)
    }

    /**
     * Returns the current format of messages used with send, list, read and write command
     */
    async getMessageFormat() {
        const result = await this.runCommand("AT+CMGF?")
        return parseInt(result.replace("+CMGF: ",""))
    }
 
    /**
     * Sets the format of messages used with send, list, read and write commands. 
     * @param {GSM.MessageFormat} format - The message format to use
     */
    async setMessageFormat(format) {
        return await this.runCommand(`AT+CMGF=${format}`)
    }

    /**
     * Returns a list of all SMS messages for a given storage and filter
     * @param {GSM.MessageStorage} storage - The message storage to read from
     * @param {GSM.MessageFilter} filter - A filter to select messages by status
     */
    async readSMS(storage, filter) {
        await this.setMessageFormat(GSM.MessageFormat.text)
        await this.setPreferredMessageStorage(storage)
        await this.setCharacterSet(GSM.CharacterSet.UCS2)
        await this.runCommand("AT+CSDH=1")
        const result = await this.runCommand(`AT+CMGL="${filter.text}"`)
        if(result.length == 0) {
            return []
        }
        return this.parser.parseTextMessageResult(result)
    }

    /**
     * Sends a SMS message to the destination number
     * @param {String} msisdn - Destination number
     * @param {String} message - Text message to 
     * @returns {String} - Reference ID if the delivery was successful
     */
    async sendSMS(msisdn, message) {
        await this.setCharacterSet(GSM.CharacterSet.UCS2)
        await this.setMessageFormat(GSM.MessageFormat.text)
        await this.runCommand(`AT+CMGS="${msisdn.UCS2HexString()}"`) // returns a prompt > for a message
        const result = await this.runCommand(`${message.UCS2HexString()}${CTRL_Z}`)
        return result.replace("+CMGS: ","")
    }

    /**
     * Deletes a message from storage
     * @param {GSM.MessageStorage} storage - The message storage to delete from
     * @param {Number} index  - The index of the message to delete
     */
    async deleteMessage(storage, index) {
        await this.setPreferredMessageStorage(storage)
        return await this.runCommand(`AT+CMGD=${index}`)
    }

    /**
     * Deletes multiple messages from storage according to the give filter
     * @param {GSM.MessageStorage} storage - The message storage to delete from
     * @param {GSM.MessageDeleteFilter} filter - The delete filter to use
     */
    async deleteAllMessages(storage, filter) {
        await this.setPreferredMessageStorage(storage)
        return await this.runCommand(`AT+CMGD=0,${filter}`)
    }

    async turnGPSOn() {
		console.log('debug-turnon');
        const reply = await this.runCommand(`AT+CGNSPWR=1`)
        this.gpsIsOn = true
        return reply
    }

    async turnGPSOff() {
		console.log('debug-turnoff');
        const reply = await this.runCommand(`AT+CGNSPWR=1`)
        this.gpsIsOn = false
        return reply
    }

    async getGPSPosition() {
        if (!this.gpsIsOn) {
            await this.turnGPSOn()
        }
		console.log('fetch');
        const reply = await this.runCommand(`AT+CGNSINF`)
        const list = reply.split(",")
        const datetime = list[2]
        return {
            datetime: datetime.slice(8, 10)+':'+datetime.slice(10, 12)+':'+datetime.slice(12, 14),
            latitude: list[3],
            longitude: list[4],
            altitude: list[5],
            rawReply: reply
        }
    }

    /**
     * 
     * @param {string} command 
     * @param {number} timeout 
     * @returns {Promise<string>}
     */
    async runCommand(command, timeout) {
        if(!timeout) { timeout = TIMEOUT_DEFAULT }
        return new Promise((resolve, reject) => {
            try {
                if (!this.connected) { return reject(new Error("Not Connected")) }
                if (this.isWaiting) { return reject(new Error("Cannot run command while already waiting for another")) }
                this.isWaiting = true

                let timeoutHandle = setTimeout(() => {
                    reject(new Error("Timeout waiting for command"))
                    this.serialPort.removeListener('data', dataHandler)
                    this.isWaiting = false
                },timeout)

                let output = ""
                const dataHandler = (data) => {
                    output += data.toString('utf8').trim()

					const endOutput = () => {
                        clearTimeout(timeoutHandle)
                        this.serialPort.removeListener('data', dataHandler)
                        this.isWaiting = false
					}

                    // OK message - success
                    if (output.endsWith(GSM.ReturnCode.ok)) {
						endOutput()
                        setTimeout(() => { resolve(output.slice(0, -GSM.ReturnCode.ok.length).trim()) },20)
                        return
                    }

                    // ERROR message - failure
                    else if (output.endsWith(GSM.ReturnCode.error)) {
						endOutput()
                        setTimeout(() => { reject(new Error('Error from modem: ' + output.slice(0, -GSM.ReturnCode.error).trim())) },20)
                        return
                    }

                    // > message - prompt for user data
                    else if (output.endsWith(GSM_PROMPT)) {
						endOutput()
                        setTimeout(() => { resolve(output) },20)
                        return
                    }
                    else {
                        // partial message, wait for more data
                    }
                }
                this.serialPort.on('data', dataHandler)
                this.serialPort.write(`${command}\r\n`)
            } catch (err) {
                reject(err);
            }
        })
    }

    toString() {
        return `[${this.connected ? "Connected" : "Not Connected"}] ${this.path} `
    }
}

Object.assign(GSM, GSMErrors)
Object.assign(GSM, Constants)
module.exports = GSM
