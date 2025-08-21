# GitGen - Windows Hosting Guide

This guide provides step-by-step instructions for hosting GitGen on a Windows computer.

## Prerequisites

Before you begin, ensure you have the following installed on your Windows machine:

- **Windows 10/11** (64-bit recommended)
- **Node.js 18+** - Download from [nodejs.org](https://nodejs.org/)
- **Git for Windows** - Download from [git-scm.com](https://git-scm.com/download/win)
- **Visual Studio Code** (optional but recommended) - Download from [code.visualstudio.com](https://code.visualstudio.com/)

## Step 1: Clone the Repository

1. Open **Command Prompt** or **PowerShell** as Administrator
2. Navigate to your desired installation directory:
   ```cmd
   cd C:\Projects
   ```
3. Clone the GitGen repository:
   ```cmd
   git clone <your-repo-url>
   cd gitgen
   ```

## Step 2: Install Dependencies

1. Install backend dependencies:
   ```cmd
   npm install
   ```

2. Install frontend dependencies:
   ```cmd
   cd client
   npm install
   cd ..
   ```

## Step 3: Environment Configuration

1. Create a `.env` file in the root directory:
   ```cmd
   echo PORT=3001 > .env
   echo NODE_ENV=production >> .env
   ```

2. Or manually create the file with these contents:
   ```env
   PORT=3001
   NODE_ENV=production
   ```

## Step 4: Build the Application

1. Build the React frontend:
   ```cmd
   npm run build:client
   ```

2. Verify the build was successful:
   ```cmd
   dir client\build
   ```

## Step 5: Start the Application

1. Start the production server:
   ```cmd
   npm start
   ```

2. The application will be available at:
   - **Frontend**: http://localhost:3001
   - **API**: http://localhost:3001/api

## Step 6: Windows Service Setup (Optional)

To run GitGen as a Windows service:

1. Install **PM2** globally:
   ```cmd
   npm install -g pm2
   ```

2. Create a PM2 ecosystem file:
   ```cmd
   pm2 init
   ```

3. Edit the generated `ecosystem.config.js`:
   ```javascript
   module.exports = {
     apps: [{
       name: 'gitgen',
       script: 'server.js',
       cwd: 'C:\\Projects\\gitgen',
       env: {
         NODE_ENV: 'production',
         PORT: 3001
       }
     }]
   }
   ```

4. Start the service:
   ```cmd
   pm2 start ecosystem.config.js
   ```

5. Save the PM2 configuration:
   ```cmd
   pm2 save
   pm2 startup
   ```

## Step 7: Firewall Configuration

1. Open **Windows Defender Firewall**:
   - Press `Win + R`, type `wf.msc`, press Enter

2. Create a new inbound rule:
   - Click **Inbound Rules** → **New Rule**
   - Select **Port** → **Next**
   - Select **TCP** and enter **3001** → **Next**
   - Select **Allow the connection** → **Next**
   - Select all profiles → **Next**
   - Name: `GitGen Web Server` → **Finish**

## Step 8: Access from Other Devices

To access GitGen from other devices on your network:

1. Find your computer's IP address:
   ```cmd
   ipconfig
   ```

2. Look for your local IP (usually starts with `192.168.` or `10.0.`)

3. Access GitGen from other devices using:
   ```
   http://YOUR_IP_ADDRESS:3001
   ```

## Troubleshooting

### Port Already in Use
If port 3001 is already in use:
1. Find the process using the port:
   ```cmd
   netstat -ano | findstr :3001
   ```
2. Kill the process:
   ```cmd
   taskkill /PID <PID_NUMBER> /F
   ```

### Node.js Not Found
If you get "node is not recognized":
1. Restart Command Prompt after installing Node.js
2. Verify Node.js installation:
   ```cmd
   node --version
   npm --version
   ```

### Build Errors
If you encounter build errors:
1. Clear npm cache:
   ```cmd
   npm cache clean --force
   ```
2. Delete node_modules and reinstall:
   ```cmd
   rmdir /s node_modules
   rmdir /s client\node_modules
   npm run install:all
   ```

## Performance Optimization

1. **Enable Windows Performance Options**:
   - Right-click **This PC** → **Properties** → **Advanced system settings**
   - Click **Performance Settings** → **Advanced**
   - Select **Programs** for better application performance

2. **Disable unnecessary Windows services**:
   - Press `Win + R`, type `services.msc`
   - Disable services you don't need (research before disabling)

3. **Use SSD storage** for better I/O performance

## Security Considerations

1. **Keep Windows updated** with latest security patches
2. **Use Windows Defender** or install a reputable antivirus
3. **Regular backups** of your GitGen data
4. **Monitor logs** for suspicious activity
5. **Use strong passwords** for any admin accounts

## Maintenance

1. **Regular updates**:
   ```cmd
   git pull origin main
   npm run install:all
   npm run build:client
   ```

2. **Log rotation**: Monitor log files and rotate them periodically
3. **Database cleanup**: Remove old temporary files and uploads
4. **Performance monitoring**: Use Task Manager to monitor resource usage

## Support

If you encounter issues:
1. Check the logs in the console output
2. Verify all prerequisites are installed correctly
3. Ensure no other applications are using port 3001
4. Check Windows Event Viewer for system errors

---

**GitGen** - Making documentation generation effortless and beautiful on Windows! 🚀