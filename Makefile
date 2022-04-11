
mkfile_path := $(word $(words $(MAKEFILE_LIST)),$(MAKEFILE_LIST))
nubo_proj_dir:=$(shell cd $(shell dirname $(mkfile_path))/..; pwd)

current_dir := $(shell pwd)

BASE_TAG := nubo_release_3.2
BASE_VERSION := 3.2
LSBDIST := $(shell lsb_release -cs)

define get_project_version
$(eval $1_version=$(BASE_VERSION))
$(eval $1_buildid=$(shell git log $(BASE_TAG)..HEAD --oneline | wc -l))
$(eval $1_buildid=$(shell echo $($1_buildid)+1 | bc))
endef

$(eval $(call get_project_version,server))


deb: $(nubo_proj_dir)/debs/latest/nubogateway2-$(server_version)-$(server_buildid).$(LSBDIST).deb

$(nubo_proj_dir)/debs/latest/nubogateway2-$(server_version)-$(server_buildid).$(LSBDIST).deb:
	NUBO_PROJ_PATH=$(nubo_proj_dir) \
	PROJ_PATH=$(current_dir) \
	Version=$(server_version).$(server_buildid) \
	./debbuilder/nubogateway2/debbuilder.sh && \
	fakeroot dpkg-deb -b debbuild/nubogateway2 $@

rpm: $(nubo_proj_dir)/rpms/latest/nubogateway2-$(server_version)-$(server_buildid).x86_64.rpm

$(nubo_proj_dir)/rpms/latest/nubogateway2-$(server_version)-$(server_buildid).x86_64.rpm:
	NUBO_PROJ_PATH=$(nubo_proj_dir) \
	PROJ_PATH=$(current_dir) \
	rpmbuild -v \
	--define "_topdir $(current_dir)/rpmbuild" \
	--define "_version $(server_version)" \
	--define "_release $(server_buildid)" \
	--define "_build_id_links none" \
	-bb rpmbuild/SPECS/nubogateway2.spec
	cp $(nubo_proj_dir)/nubogateway2/rpmbuild/RPMS/x86_64/nubogateway2-$(server_version)-$(server_buildid).x86_64.rpm $@

docker:
	docker build --build-arg BUILD_VER=$(server_version)-$(server_buildid) --no-cache --pull -f  docker_build/Dockerfile -t gateway:$(server_version)-$(server_buildid) .

push-nubo: docker
	docker tag gateway:$(server_version)-$(server_buildid) docker.nubosoftware.com:5000/nubo/gateway:$(server_version)-$(server_buildid)
	docker push docker.nubosoftware.com:5000/nubo/gateway:$(server_version)-$(server_buildid)
	docker tag gateway:$(server_version)-$(server_buildid) docker.nubosoftware.com:5000/nubo/gateway:$(server_version)
	docker push docker.nubosoftware.com:5000/nubo/gateway:$(server_version)

push-nubo-latest: push-nubo
	docker tag gateway:$(server_version)-$(server_buildid) docker.nubosoftware.com:5000/nubo/gateway
	docker push docker.nubosoftware.com:5000/nubo/gateway

push-hub: docker
	docker tag gateway:$(server_version)-$(server_buildid) nubosoftware/gateway:$(server_version)-$(server_buildid)
	docker push nubosoftware/gateway:$(server_version)-$(server_buildid)
	docker tag gateway:$(server_version)-$(server_buildid) nubosoftware/gateway:$(server_version)
	docker push nubosoftware/gateway:$(server_version)

push-hub-latest: push-nubo
	docker tag gateway:$(server_version)-$(server_buildid) nubosoftware/gateway
	docker push nubosoftware/gateway


.PHONY: deb default rpm docker

