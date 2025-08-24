// Demo file for testing suppression features

// This will be flagged
const apiKey = 'sk-1234567890abcdef';

// ubon-disable-next-line SEC001 This is a test API key
const testApiKey = 'sk-test1234567890abcdef';

// This will be flagged  
eval('console.log("dangerous")');

// ubon-disable-next-line SEC016 Safe eval for demo purposes
eval('console.log("suppressed eval")');

/* ubon-disable-next-line SEC018 */
const highEntropyString = 'abcdef1234567890ZYXWVU9876543210';

// ubon-disable-next-line SEC015 Debug logging needed for troubleshooting
console.log('This console.log is suppressed');

// This will be flagged
console.log('This console.log will show up');
