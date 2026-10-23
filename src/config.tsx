/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 Red Hat, Inc.
 */

import { useState, useEffect, useReducer } from "react";
import cockpit from "cockpit";

import { toaster } from "./toaster";

const _ = cockpit.gettext;

/* CONFIGURATION

   The user constructs a simple playbook via the UI that consists of a
   couple of plays.  Each play refers to a singhle system role and
   specifies the variables for it.  A simple example might look like
   this:

       - name: linux-system-roles.nbde_server
         hosts: all
         vars:
           nbde_server_port: 88
           nbde_server_manage_selinux: true
           nbde_server_firewall_zone: virt
         roles:
           - linux-system-roles.nbde_server
       - name: linux-system-roles.firewall
         hosts: all
         vars: {}
         roles:
           - linux-system-roles.firewall

   This playbook will run the "nbde_server" system role with
   "nbde_server_port" set to 88, for example.  The "firewall" role is
   executed with its defaults.

   The user is contructing this playbook incrementally and we save the
   state of that after each keypress (there is debouncing of course).
   Thus, we need to be able to represent intermediate invalid
   playbooks as well, such as when the user types "8 8" instead of a
   valid number.

   Thus, we store the application state in our custom format and
   create a playbook from it only once we actually run it.

   And even if a different UI approach would make it unnecessary to
   store intermediate invalid input, we are of the opinion that
   storing the Application state as a playbook is unneccessary and too
   restricting.

   The custom format is a JSON object with the structure described
   below, and saved in "/etc/cockpit/system-roles.json".

   The most interesting bit is that variable values are always stored
   in it in their JSON serialization.  For example, the "int" value 80
   for "nbde_server_port" is stored as JSON.stringify(80), which is
   "80".  Likewise a string value like "virt" above for
   "nbde_server_firewall_zone" is stored as JSON.stringify("virt"),
   which is "\"virt\"".

   The API for accessing the stored state is a React hook for reading
   and a couple functions for updating.  There should be only one use
   of the hook in the whole application.  Updating works without
   mutating the existing state value.
 */

export interface VarConfig {
    value: string; // Always JSON, but maybe not valid
}

export interface RoleConfig {
    name: string;
    vars: Record<string, VarConfig>;
}

export interface Config {
    roles: RoleConfig[];
}

export class AppConfig {
    #file: cockpit.FileHandle<unknown>;
    #tag: string;

    config: Config;

    constructor(file: cockpit.FileHandle<unknown>, data: unknown, tag: string) {
        this.#file = file;
        this.#tag = tag;
        this.config = data as Config;
    }

    _set(file: cockpit.FileHandle<unknown>, data: unknown, tag: string) {
        this.#file = file;
        this.#tag = tag;
        this.config = data as Config;
        console.log("CONFIG", tag, JSON.stringify(this.config));
    }

    async modify(func: (old: Config) => Config) {
        // This will also call the watch callback, so if you await the
        // call to "modify", this.config is guaranteed to reflect the
        // changes.
        const new_config = func(this.config);
        console.log("CHANGE", JSON.stringify(this.config));
        console.log("TO    ", JSON.stringify(new_config));
        // XXX - this.#file.modify does the same, but we can't get TS
        // to accept its weird multi-value promises.
        let count = 0;
        while (true) {
            count += 1;
            try {
                console.log("TRY", count, this.#tag);
                await this.#file.replace(func(this.config), this.#tag);
                break;
            } catch (ex) {
                console.log("FAILED", ex);
                if (ex && typeof ex == "object" && "problem" in ex) {
                    console.log("PROBLEM", ex.problem);
                    if (ex.problem !== "change-conflict" || count > 100)
                        throw ex;
                    // This will call the watch callback synchornously
                    // and thus update this.config and this.#tag for
                    // the next try.
                    await this.#file.read();
                } else
                    throw ex;
            }
        }
    }
}

export const useAppConfig = () => {
    const [config, setConfig] = useState<AppConfig | null>(null);
    const [error, setError] = useState<unknown>(null);
    const [, forceUpdate] = useReducer(x => x + 1, 0);

    useEffect(
        () => {
            const file: cockpit.FileHandle<unknown> = cockpit.file(
                "/etc/cockpit/system-roles.json",
                { syntax: JSON, superuser: "require" }
            );

            file.watch(
                (data, tag, error) => {
                    if (error) {
                        setError(error);
                        setConfig(null);
                    } else {
                        cockpit.assert(tag);
                        if (!data)
                            data = { roles: [] };

                        setError(null);
                        setConfig(config => {
                            if (config instanceof AppConfig) {
                                config._set(file, data, tag);
                                forceUpdate();
                                return config;
                            } else {
                                return new AppConfig(file, data, tag);
                            }
                        });
                    }
                }
            );
        },
        [],
    );

    return { config, error };
};

export async function update_variable(config: AppConfig, role: string, name: string, value: string) {
    function update_vars(vars: Record<string, VarConfig>) {
        if (value !== "")
            return {
                ...vars,
                [name]: { ...vars[name], value }
            };
        else {
            const new_vars = { ...vars };
            delete new_vars[name];
            return new_vars;
        }
    }

    function update_role(r: RoleConfig) {
        if (r.name === role) {
            return { ...r, vars: update_vars(r.vars) };
        } else {
            return r;
        }
    }

    try {
        console.log("UPDATE", role, name, JSON.stringify(value));
        await config.modify(
            conf => {
                return {
                    ...conf,
                    roles: conf.roles.map(update_role)
                };
            }
        );
        console.log("UPDATE done", role, name, JSON.stringify(value));
    } catch (ex) {
        toaster.add_error(_("Failed to update the configuration"), ex);
    }
}

export async function add_role(config: AppConfig, name: string) {
    try {
        await config.modify(conf => ({ ...conf, roles: [...conf.roles, { name, vars: {} }] }));
    } catch (ex) {
        toaster.add_error(_("Failed to add role"), ex);
    }
}

export async function remove_role(config: AppConfig, name: string) {
    try {
        await config.modify(
            conf => {
                return {
                    ...conf,
                    roles: conf.roles.filter(r => r.name !== name)
                };
            }
        );
    } catch (ex) {
        toaster.add_error(_("Failed to remove role"), ex);
    }
}
