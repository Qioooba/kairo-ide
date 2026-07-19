$env:CATALINA_HOME = 'E:\Apps\Tomcat6\apache-tomcat-6.0.53'
$env:JAVA_HOME = 'E:\Tools\jdk17'
& "$env:CATALINA_HOME\bin\version.bat" 2>&1 | Select-Object -First 8 | ForEach-Object { Write-Host $_ }
