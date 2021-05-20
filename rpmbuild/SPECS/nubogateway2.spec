Summary: nubogateway service
Name: nubogateway2
Version: %{_version}
Release: %{_release}
Group: System Environment/Daemons
BuildArch: x86_64
License: none
Requires: nodejs >= 4.4.5

%description
Service that implement api of possible requests to nubo platform

#%prep
#%setup -q
#%patch -p1 -b .buildroot

%build

%install
rm -rf $RPM_BUILD_ROOT
mkdir -p $RPM_BUILD_ROOT/opt/nubogateway
mkdir -p $RPM_BUILD_ROOT/etc/systemd/system/
mkdir -p $RPM_BUILD_ROOT/etc/rsyslog.d

#Copy js files from git project
FILES=`git ls-tree --full-tree -r HEAD | awk '$4 ~ /.+\.js$/ {print $4}'`
for file in ${FILES}; do
    install -D -m 644 $PROJ_PATH/$file $RPM_BUILD_ROOT/opt/nubogateway/$file
done
#install -m 644 $PROJ_PATH/Settings.json.init $RPM_BUILD_ROOT/opt/nubogateway/Settings.json
echo "{}" > $RPM_BUILD_ROOT/opt/nubogateway/Settings.json
install -m 644 $NUBO_PROJ_PATH/nubogateway2/nubogateway.service $RPM_BUILD_ROOT/etc/systemd/system/nubogateway.service
install -m 644 $NUBO_PROJ_PATH/nubogateway2/rsyslog-gateway.conf $RPM_BUILD_ROOT/etc/rsyslog.d/18-nubo-gateway.conf
install -m 644 $PROJ_PATH/package.json $RPM_BUILD_ROOT/opt/nubogateway/package.json


cd $RPM_BUILD_ROOT/opt/nubogateway
npm install
rm package.json
find $RPM_BUILD_ROOT/opt/nubogateway/node_modules -type f -exec sed "s?$RPM_BUILD_ROOT?/?g" -i {} \;
cd -

%post
systemctl enable nubogateway > /dev/null 2>&1 ||:

#Restart after every install/update
systemctl restart nubogateway > /dev/null 2>&1 ||:

%preun
if [ $1 = 0 ]; then
	#Stop service and remove from services list on full remove
	systemctl disable nubogateway > /dev/null 2>&1 ||:
	systemctl stop nubogateway > /dev/null 2>&1 ||:
fi

%postun
if [ "$1" -ge "1" ]; then
	#Restart service after downgrade
	systemctl restart nubogateway > /dev/null 2>&1 ||:
fi

%clean
rm -rf $RPM_BUILD_ROOT

%files
%defattr(-,root,root)

/opt/nubogateway
%config(noreplace) /opt/nubogateway/Settings.json

/etc/systemd/system/nubogateway.service
%config(noreplace) /etc/rsyslog.d/18-nubo-gateway.conf

