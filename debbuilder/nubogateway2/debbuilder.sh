BUILD_ROOT=${BUILD_ROOT:="$PROJ_PATH/debbuild"}/nubogateway2
Version=${Version:="1.0.0"}

echo "NUBO_PROJ_PATH $NUBO_PROJ_PATH"
echo "BUILD_ROOT $BUILD_ROOT"

rm -rf $BUILD_ROOT
mkdir -p $BUILD_ROOT/opt/nubogateway
mkdir -p $BUILD_ROOT/etc/systemd/system
mkdir -p $BUILD_ROOT/etc/rsyslog.d
mkdir -p $BUILD_ROOT/etc/logrotate.d

echo "Run webpack..."
cd $NUBO_PROJ_PATH/nubogateway2
npm run-script build
cp -a dist/ $BUILD_ROOT/opt/nubogateway/dist/
cd -

#JSFILES=`git ls-tree --full-tree -r HEAD | awk '$4 ~ /.+\.js$/ {print $4}'`
#for file in ${JSFILES}; do
#    install -D -m 644 $PROJ_PATH/$file $BUILD_ROOT/opt/nubogateway/$file
#done
install -m 644 $PROJ_PATH/package.json $BUILD_ROOT/opt/nubogateway/package.json
cd $BUILD_ROOT/opt/nubogateway/
npm install --only=prod || exit 1
rm package.json
cd -

install -D -m 644 $NUBO_PROJ_PATH/nubogateway2/nubogateway.service $BUILD_ROOT/etc/systemd/system/nubogateway.service
install -m 644 $NUBO_PROJ_PATH/nubogateway2/rsyslog-gateway.conf $BUILD_ROOT/etc/rsyslog.d/18-nubo-gateway.conf
echo "{}" > $BUILD_ROOT/opt/nubogateway/Settings.json

rsync -r $PROJ_PATH/debbuilder/nubogateway2/DEBIAN/ $BUILD_ROOT/DEBIAN/
sed "s/%Version%/$Version/g" -i $BUILD_ROOT/DEBIAN/control

