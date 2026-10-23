/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 Red Hat, Inc.
 */

import React from 'react';
import { AlertGroup } from "@patternfly/react-core/dist/esm/components/Alert";
import { InlineNotification } from 'cockpit-components-inline-notification.jsx';
import { useOn } from "hooks";
import { EventEmitter } from "cockpit/event";

interface Toast {
    message: string;
    details: string;
}

interface ToasterEvents {
    changed: () => void;
}

class Toaster extends EventEmitter<ToasterEvents> {
    toasts: Toast[] = [];

    add(message: string, details: string) {
        this.toasts.push({ message, details });
        this.emit("changed");
    }

    remove(index: number) {
        this.toasts.splice(index, 1);
        this.emit("changed");
    }

    add_error(message: string, error: unknown) {
        console.warn("Error:", String(error));
        this.add(message, String(error));
    }
}

export const toaster = new Toaster();

export const ToastArea = () => {
    useOn(toaster, "changed");

    return (
        <AlertGroup isToast>
            {
                toaster.toasts.map(
                    (t, i) => {
                        return (
                            <InlineNotification
                                key={i}
                                type="danger"
                                isLiveRegion
                                isInline={false}
                                onDismiss={() => toaster.remove(i)}
                                text={t.message}
                                detail={t.details}
                            />
                        );
                    }
                )
            }
        </AlertGroup>
    );
};
