// test-api.js - Test MDuc Flood API
const axios = require('axios');

const API_URL = process.env.API_URL || 'http://localhost:3000';
const OWNER_KEY = process.env.OWNER_KEY || 'your_owner_key_here';

async function testAPI() {
    console.log('🧪 Testing MDuc Flood API...\n');
    
    try {
        // 1. Test API info
        console.log('1. Testing API info...');
        const info = await axios.get(`${API_URL}/api/v1/info`);
        console.log('✅ API Info:', info.data.app, info.data.version);
        
        // 2. Test system status
        console.log('\n2. Testing system status...');
        const status = await axios.get(`${API_URL}/api/v1/system/status`);
        console.log('✅ System Status:', status.data.system.uptime, 'seconds uptime');
        
        // 3. Create test API key (owner only)
        console.log('\n3. Creating test API key...');
        const newKey = await axios.post(`${API_URL}/api/v1/key/create`, {
            name: "Test User",
            max_time: 300,
            max_threads: 20,
            max_rate: 100,
            max_browsers: 5,
            max_concurrent: 3,
            daily_limit: 10,
            allowed_options: ["--browser", "--randpath", "--reset"]
        }, {
            headers: { 'X-API-Key': OWNER_KEY }
        });
        
        const TEST_API_KEY = newKey.data.api_key;
        console.log('✅ Test API Key created:', TEST_API_KEY.substring(0, 8) + '...');
        
        // 4. Test browser-based attack
        console.log('\n4. Testing browser-based attack...');
        const attack = await axios.post(`${API_URL}/api/v1/attack/start`, {
            target: "https://example.com",
            time: 30, // 30 giây test
            threads: 5,
            rate: 50,
            browser: 2, // 2 browsers
            options: ["--randpath"]
        }, {
            headers: { 'X-API-Key': TEST_API_KEY }
        });
        
        console.log('✅ Attack started:', attack.data.attack_id);
        console.log('   Details:', attack.data.details);
        
        // 5. Check attack status
        console.log('\n5. Checking attack status...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const attackStatus = await axios.get(
            `${API_URL}/api/v1/attack/details/${attack.data.attack_id}`,
            { headers: { 'X-API-Key': TEST_API_KEY } }
        );
        
        console.log('✅ Attack status:', attackStatus.data.status, attackStatus.data.progress);
        
        // 6. Stop attack
        console.log('\n6. Stopping attack...');
        const stopAttack = await axios.post(
            `${API_URL}/api/v1/attack/stop/${attack.data.attack_id}`,
            {},
            { headers: { 'X-API-Key': TEST_API_KEY } }
        );
        
        console.log('✅ Attack stopped:', stopAttack.data.message);
        
        // 7. Get API key info
        console.log('\n7. Getting API key info...');
        const keyInfo = await axios.get(`${API_URL}/api/v1/key/info`, {
            headers: { 'X-API-Key': TEST_API_KEY }
        });
        
        console.log('✅ Key Info:', keyInfo.data.limits);
        
        console.log('\n🎉 All tests passed! MDuc Flood API is working correctly.');
        
    } catch (error) {
        console.error('\n❌ Test failed:', error.response?.data || error.message);
    }
}

testAPI();
